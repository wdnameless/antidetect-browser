// Probe the fingerprint-chromium kernel on macOS/Apple Silicon.
//
// The question this answers, with measurements rather than assumption: on an M1 (arm64), does the
// pinned macOS kernel run at all, is it native or emulated, does `--fingerprint` actually change
// the JS-visible surface, and does the kernel's CDP-stealth hold (navigator.webdriver === false)?
//
// It exists because `kernelAcquire.ts` pins a macOS asset and then throws
// ERR_UNSUPPORTED_HOST_EXTRACTION for it — the `dmg` branch was never implemented. Before writing
// that branch, we need to know whether there is a working kernel underneath it at all.
//
// Runs on macOS only. Writes a JSON report to stdout between markers so the workflow can extract
// it; every check is independent, so a failure late does not hide the earlier facts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ASSET = 'ungoogled-chromium_148.0.7778.215-1.1_macos.dmg';
const URL_BASE = 'https://github.com/adryfish/fingerprint-chromium/releases/download/148.0.7778.215';
const EXPECTED_SHA256 = 'b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679';
const EXPECTED_SIZE = 140187500;

const WORK = process.env.PROBE_WORKDIR ?? path.join(process.cwd(), '.probe-kernel');
const report = { steps: [], checks: {}, fatal: null };

const log = (msg) => console.log(`[probe] ${msg}`);
const step = (name, ok, detail) => {
  report.steps.push({ name, ok, detail: detail === undefined ? null : String(detail).slice(0, 400) });
  log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
};

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  report.host = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    // `sysctl -n sysctl.proc_translated` is 1 when THIS process runs under Rosetta. Node itself
    // is arm64 on these runners, so it should read 0 — it is recorded as the baseline against
    // which the browser's own translation state is compared.
    proc_translated: run('sysctl', ['-n', 'sysctl.proc_translated']).stdout?.trim() || '(unavailable)',
    cpu: run('sysctl', ['-n', 'machdep.cpu.brand_string']).stdout?.trim() || '(unknown)',
  };
  log(`host: ${report.host.cpu} / ${report.host.arch} / translated=${report.host.proc_translated}`);

  // --- 1. Download -------------------------------------------------------------------------
  const dmgPath = path.join(WORK, ASSET);
  if (!fs.existsSync(dmgPath)) {
    log(`downloading ${ASSET} (~134 MB)...`);
    const res = await fetch(`${URL_BASE}/${ASSET}`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dmgPath, buf);
  }
  const size = fs.statSync(dmgPath).size;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(dmgPath)).digest('hex');
  report.checks.download = { size, sizeMatches: size === EXPECTED_SIZE, sha256: sha };
  step('download', sha === EXPECTED_SHA256, `${(size / 1048576).toFixed(1)} MB, sha256 ${sha.slice(0, 16)}…`);
  if (sha !== EXPECTED_SHA256) throw new Error(`digest mismatch: ${sha}`);

  // --- 2. Mount ----------------------------------------------------------------------------
  // `-nobrowse` keeps it out of Finder; `-readonly` avoids writing to the image. The mount point
  // is parsed from plist output because it is not fixed (it can be /Volumes/Chromium or
  // /Volumes/Chromium 1 when a stale mount exists).
  const attach = run('hdiutil', ['attach', '-nobrowse', '-readonly', '-plist', dmgPath]);
  if (attach.status !== 0) {
    step('hdiutil attach', false, attach.stderr?.trim());
    throw new Error('hdiutil attach failed');
  }
  const mountPoint = (attach.stdout.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/) || [])[1];
  step('hdiutil attach', Boolean(mountPoint), mountPoint);
  if (!mountPoint) throw new Error('could not parse mount point');

  try {
    const entries = fs.readdirSync(mountPoint);
    report.checks.mountedEntries = entries;
    step('list image', true, entries.join(', '));

    const appName = entries.find((e) => e.endsWith('.app'));
    if (!appName) throw new Error('no .app found in the image');
    const srcApp = path.join(mountPoint, appName);
    const destApp = path.join(WORK, appName);
    fs.rmSync(destApp, { recursive: true, force: true });
    // `cp -R` preserves the bundle's symlinks, which a naive recursive copy would flatten.
    const cp = run('cp', ['-R', srcApp, destApp]);
    step('copy app out of image', cp.status === 0, cp.stderr?.trim());
    if (cp.status !== 0) throw new Error('copy failed');

    const exeName = path.basename(destApp, '.app');
    const exePath = path.join(destApp, 'Contents', 'MacOS', exeName);
    report.checks.executable = { name: exeName, exists: fs.existsSync(exePath) };
    step('locate executable', fs.existsSync(exePath), exePath);

    // --- 3. Architecture: native arm64, or x86_64 that needs Rosetta? ---------------------
    const lipo = run('lipo', ['-archs', exePath]);
    const archs = (lipo.stdout || '').trim();
    const fileOut = run('file', [exePath]).stdout?.trim();
    report.checks.architecture = { archs, file: fileOut };
    step('architecture', true, `lipo: ${archs || '(failed)'} | file: ${fileOut || ''}`);
    report.checks.runs_natively = archs.includes('arm64');

    // --- 4. Signature: ad-hoc or none? ------------------------------------------------------
    // On Apple Silicon an unsigned arm64 binary cannot execute at all; the kernel is refused
    // before Gatekeeper is even consulted. This tells us which state we are in.
    const codesign = run('codesign', ['-dv', '--verbose=2', exePath]);
    const sigInfo = `${codesign.stderr || ''}${codesign.stdout || ''}`.trim();
    report.checks.signature = { status: codesign.status, info: sigInfo.slice(0, 600) };
    step('codesign inspect', codesign.status === 0, sigInfo.split('\n').slice(0, 3).join(' | '));

    // --- 5. Quarantine ----------------------------------------------------------------------
    // A downloaded, quarantined bundle is refused on first launch. This is the documented one-time
    // step for the app itself; the kernel needs the same treatment.
    run('xattr', ['-dr', 'com.apple.quarantine', destApp]);
    const xattr = run('xattr', ['-r', destApp]);
    report.checks.quarantineCleared = !(xattr.stdout || '').includes('com.apple.quarantine');
    step('clear quarantine', report.checks.quarantineCleared, `remaining: ${(xattr.stdout || '').trim().slice(0, 120) || 'none'}`);

    // --- 6. Launch under CDP ----------------------------------------------------------------
    const userDataDir = path.join(WORK, 'userdata');
    fs.rmSync(userDataDir, { recursive: true, force: true });
    const port = 9333;

    const launchOnce = async (seed, headed) => {
      const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${path.join(userDataDir, String(seed))}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate',
        `--fingerprint=${seed}`,
        '--fingerprint-platform=macos',
        '--fingerprint-brand=Chrome',
        'about:blank',
      ];
      if (!headed) args.unshift('--headless=new');

      const child = spawnSync('true', [], {}); // placeholder to keep import shape obvious
      void child;
      const { spawn } = await import('node:child_process');
      const proc = spawn(exePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      // Wait for the debugging endpoint rather than sleeping a fixed amount.
      let wsUrl = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
          const page = list.find((t) => t.type === 'page');
          if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
        } catch {
          // not up yet
        }
        if (proc.exitCode !== null) break;
      }
      if (!wsUrl) {
        proc.kill('SIGKILL');
        return { launched: false, stderr: stderr.slice(0, 900), exitCode: proc.exitCode };
      }

      const result = await evaluateOverCdp(wsUrl);
      result.stderr = stderr.slice(0, 900);
      // Record how macOS is running the browser process: a translated process reports 1.
      const psArch = run('ps', ['-o', 'arch=', '-p', String(proc.pid)]).stdout?.trim();
      result.processArch = psArch || '(unknown)';
      proc.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 1000));
      return result;
    };

    log('launching headed with --fingerprint=2023 ...');
    let first = await launchOnce(2023, true);
    if (!first.launched) {
      log(`headed launch failed (${first.stderr?.slice(0, 200)}); retrying headless`);
      first = await launchOnce(2023, false);
    }
    report.checks.launch = first;
    step('launch + CDP', first.launched, first.launched
      ? `arch=${first.processArch} platform=${first.surface?.platform} ua=${(first.surface?.userAgent || '').slice(0, 60)}`
      : first.stderr);

    // A second seed: if the surface is identical, the kernel flags are being ignored and the
    // browser is stock — which would make the whole macOS port pointless.
    if (first.launched) {
      log('launching with --fingerprint=4242 to compare ...');
      const second = await launchOnce(4242, false);
      report.checks.secondSeed = second;
      const changed = first.surface && second.surface
        && JSON.stringify(first.surface) !== JSON.stringify(second.surface);
      report.checks.fingerprint_flags_effective = Boolean(changed);
      step('fingerprint flags change the surface', Boolean(changed),
        changed ? 'surfaces differ' : 'IDENTICAL — flags may be ignored');

      // The single most important stealth property from KERNEL.md: CDP attached, yet webdriver
      // stays false. A stock build fails exactly here.
      report.checks.webdriver_false = first.surface?.webdriver === false;
      step('navigator.webdriver === false under CDP', report.checks.webdriver_false,
        String(first.surface?.webdriver));
    }
  } finally {
    run('hdiutil', ['detach', mountPoint, '-force']);
  }

  log('--- PROBE_JSON_BEGIN ---');
  console.log(JSON.stringify(report, null, 2));
  log('--- PROBE_JSON_END ---');
}

/** Evaluate the fingerprint surface over a raw CDP WebSocket (no puppeteer dependency). */
async function evaluateOverCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const expression = `(() => {
    const out = {
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null,
      maxTouchPoints: navigator.maxTouchPoints,
      languages: (navigator.languages || []).join(','),
      hasChrome: typeof window.chrome === 'object' && window.chrome !== null,
      vendor: navigator.vendor,
    };
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl');
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      out.webglVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null;
      out.webglRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
    } catch (e) { out.webglError = String(e); }
    try {
      const c2 = document.createElement('canvas');
      c2.width = 200; c2.height = 50;
      const ctx = c2.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 200, 50);
      ctx.fillStyle = '#069';
      ctx.fillText('NullTrace probe', 2, 15);
      const data = c2.toDataURL();
      let h = 0;
      for (let i = 0; i < data.length; i++) h = ((h << 5) - h + data.charCodeAt(i)) | 0;
      out.canvasHash = h;
    } catch (e) { out.canvasError = String(e); }
    return JSON.stringify(out);
  })()`;

  return await new Promise((resolve) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve({ launched: false, stderr: 'CDP timeout' }); }, 30000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      const raw = msg.result?.result?.value;
      resolve({ launched: true, surface: raw ? JSON.parse(raw) : null, cdpError: msg.result?.exceptionDetails ?? null });
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve({ launched: false, stderr: 'CDP socket error' });
    });
  });
}

main().catch((err) => {
  report.fatal = err.message;
  log(`FATAL: ${err.message}`);
  log('--- PROBE_JSON_BEGIN ---');
  console.log(JSON.stringify(report, null, 2));
  log('--- PROBE_JSON_END ---');
  process.exitCode = 1;
});
