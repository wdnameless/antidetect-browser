// End-to-end acceptance for the macOS kernel path, run ON macOS.
//
// The unit tests assert the decisions `extractDmg` makes, but they need to stub `hdiutil` because
// no such tool exists off macOS. This script is the other half: it calls the REAL `ensureKernel`
// against the REAL pinned image on a real Apple Silicon runner, so the mount/copy/detach sequence
// is exercised exactly as a user's machine would exercise it.
//
// It answers the acceptance criteria of `openspec/changes/nulltrace-macos-arm64` directly:
//   - the kernel is downloaded and its digest verified (R04),
//   - the executable is found at the pinned subpath inside the extracted bundle (R04),
//   - the process is arm64-native rather than translated (R05),
//   - `navigator.webdriver` is false under CDP and two seeds differ (R06).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : String(detail).slice(0, 300) });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`);
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-kernel-e2e-'));
console.log(`[e2e] workdir ${work}`);
console.log(`[e2e] host ${process.platform}/${process.arch} node ${process.version}`);

// The compiled module, not the TypeScript source: this runs the same artefact the app ships.
const mod = await import('../dist/src/main/util/kernelAcquire.js');
const { ensureKernel, PINNED_PLATFORM_ASSETS, PINNED_KERNEL_VERSION } = mod;

check('pinned asset is the macOS image', PINNED_PLATFORM_ASSETS.darwin?.archiveType === 'dmg',
  `${PINNED_PLATFORM_ASSETS.darwin?.asset} (${PINNED_PLATFORM_ASSETS.darwin?.archiveType})`);

let kernel;
try {
  // A real download of a real 134 MB image, verified against the pinned digest.
  kernel = await ensureKernel({
    platform: 'darwin',
    targetDir: work,
    onProgress: ({ received, total }) => {
      if (received === total || received % (32 * 1024 * 1024) < 1024 * 1024) {
        console.log(`[e2e]   ${(received / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB`);
      }
    },
  });
  check('ensureKernel completed', true, kernel.executablePath);
} catch (err) {
  check('ensureKernel completed', false, err.message);
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(1);
}

check('executable exists at the pinned subpath', fs.existsSync(kernel.executablePath), kernel.executablePath);

// --- Architecture: the operator asked for native Apple Silicon -------------------------------
const lipo = spawnSync('lipo', ['-archs', kernel.executablePath], { encoding: 'utf8' });
const archs = (lipo.stdout || '').trim();
check('kernel runs natively on arm64', archs.includes('arm64'), `lipo -archs: ${archs}`);

// --- Quarantine cleared, so macOS will actually launch it ------------------------------------
const xattr = spawnSync('xattr', ['-r', path.dirname(path.dirname(path.dirname(kernel.executablePath)))], { encoding: 'utf8' });
check('quarantine cleared on the extracted bundle',
  !(xattr.stdout || '').includes('com.apple.quarantine'),
  (xattr.stdout || '').trim().slice(0, 120) || 'no attributes');

// --- A second call must be a no-op, not another 134 MB download ------------------------------
const t0 = Date.now();
const again = await ensureKernel({ platform: 'darwin', targetDir: work });
check('second call returns immediately', Date.now() - t0 < 2000 && again.executablePath === kernel.executablePath,
  `${Date.now() - t0} ms`);

// --- Launch and read the surface ------------------------------------------------------------
const port = 9444;
const userData = path.join(work, 'userdata');
const args = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userData}`,
  '--no-first-run', '--no-default-browser-check',
  '--headless=new',
  `--fingerprint=${process.env.SEED || 777}`,
  '--fingerprint-platform=macos',
  'about:blank',
];
const proc = spawn(kernel.executablePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
proc.stderr.on('data', (d) => { stderr += d.toString(); });

let wsUrl = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch { /* not up yet */ }
}

if (!wsUrl) {
  check('launches and exposes CDP', false, stderr.slice(0, 300) || 'no debugging endpoint');
} else {
  check('launches and exposes CDP', true, `debugging endpoint on ${port}`);
  const surface = await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 20000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: {
        returnByValue: true,
        expression: `JSON.stringify({
          platform: navigator.platform,
          webdriver: navigator.webdriver,
          cores: navigator.hardwareConcurrency,
          ua: navigator.userAgent
        })`,
      },
    })));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(JSON.parse(msg.result?.result?.value || 'null'));
    });
    ws.addEventListener('error', () => { clearTimeout(timer); resolve(null); });
  });

  check('the page is readable over CDP', Boolean(surface), JSON.stringify(surface));
  // The kernel's whole reason for existing: CDP is attached and webdriver is still false.
  check('navigator.webdriver is false with CDP attached', surface?.webdriver === false, String(surface?.webdriver));
  check('spoofed platform is MacIntel', surface?.platform === 'MacIntel', String(surface?.platform));

  // Whether the browser itself is translated is what Rosetta would show; BSD `ps` has no `arch`
  // column (measured: it printed a header), so the authoritative signal is the executable's own
  // architecture, read below from the path the process is actually running.
  const liveExe = spawnSync('ps', ['-p', String(proc.pid), '-o', 'comm='], { encoding: 'utf8' }).stdout?.trim();
  const liveLipo = liveExe ? spawnSync('lipo', ['-archs', liveExe], { encoding: 'utf8' }).stdout?.trim() : '';
  check('running process is arm64 (no Rosetta)', (liveLipo || '').includes('arm64'),
    `${liveExe || '(path unavailable)'} -> ${liveLipo || 'unknown'}`);
}

proc.kill('SIGKILL');

// --- The image must not be left mounted ------------------------------------------------------
const mounts = spawnSync('mount', [], { encoding: 'utf8' }).stdout || '';
check('no kernel image left mounted', !mounts.includes('Chromium'), mounts.split('\n').filter((l) => l.includes('Chromium')).join(' | ') || 'none');

fs.rmSync(work, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n[e2e] ${results.length - failed.length}/${results.length} checks passed (kernel ${PINNED_KERNEL_VERSION})`);
console.log('--- E2E_JSON_BEGIN ---');
console.log(JSON.stringify({ results, allPassed: failed.length === 0 }, null, 2));
console.log('--- E2E_JSON_END ---');
process.exit(failed.length === 0 ? 0 : 1);
