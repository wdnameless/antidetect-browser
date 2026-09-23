// Empirical probe #2: launches the real kernel WITH the real stealth extension our product
// generates, then measures the same surfaces on the MAIN thread and inside a Web Worker.
//
// Probe #1 taught two things the hard way, both fixed here:
//   - `navigator.userAgentData` is undefined on `about:blank` (not a secure/HTTP context), so the
//     Client Hints surface was never actually observed. This probe serves a real http origin.
//   - The two canvas measurements were not comparable (toDataURL on the main thread vs
//     getImageData in the worker). Both now use getImageData at identical dimensions and font.
//
// Run: node scripts/probe-stealth-contexts.mjs [seed]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const EXE = path.resolve('data/chromium/fingerprint-chromium/ungoogled-chromium_148.0.7778.215-1.1_windows_x64/chrome.exe');
const SEED = Number(process.argv[2] ?? 2023);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-context-probe-'));

// --- Build the real stealth extension using the product's own code -------------------------
// Resolved from the REPO ROOT, not from scripts/: `createRequire` resolves relative to the
// importing file, so './dist/…' looked for scripts/dist and failed. `fileURLToPath` is used
// rather than hand-parsing the URL — it handles the Windows drive-letter form correctly and
// cannot throw on our own static import.meta.url.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildStealthScript } = require(path.join(ROOT, 'dist/src/main/proxy/stealthInjection.js'));
// Mirrors what the launcher now passes when the kernel is present: the JavaScript layer stands
// down on the surfaces the engine already spoofs. Set NT_SIMULATE_OLD_LAYER=1 to reproduce the
// pre-fix behaviour (JavaScript overrides canvas and deviceMemory on the main thread only).
const simulateOld = process.env.NT_SIMULATE_OLD_LAYER === '1';
const stealthOpts = {
  engineCovers: simulateOld ? undefined : { canvas: true, deviceMemory: true },
  mobile: false,
  logicalPlatform: 'macos',
  platformVersion: '14.5.0',
  hardwareConcurrency: 10,
  deviceMemory: 8,
  maxTouchPoints: 0,
  seed: SEED,
  locale: 'en-US',
  webglVendor: 'Google Inc. (Apple)',
  webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
  chip: 'Apple M2',
  architecture: 'arm',
  fontList: ['Arial', 'Helvetica', 'Times New Roman'],
};
const extDir = path.join(userDataDir, 'ext');
fs.mkdirSync(extDir, { recursive: true });
fs.writeFileSync(path.join(extDir, 'stealth.js'), buildStealthScript(stealthOpts), 'utf8');
fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({
  manifest_version: 3,
  name: 'Stealth Layer',
  version: '1.0.0',
  content_scripts: [{
    matches: ['<all_urls>'], js: ['stealth.js'], run_at: 'document_start', world: 'MAIN', all_frames: true,
  }],
}, null, 2), 'utf8');

// --- Serve a real origin so Client Hints / secure-context APIs exist -----------------------
const PAGE = '<!doctype html><meta charset="utf-8"><title>probe</title><body>probe</body>';
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}/`;

// Identical canvas recipe for BOTH contexts: getImageData at the same size and font.
const DRAW = `(ctx) => {
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 200, 25);
  ctx.fillStyle = '#069'; ctx.fillText('NullTrace parity probe', 2, 2);
}`;

const MAIN_PROBE = `(async () => {
  const draw = ${DRAW};
  const o = {
    ua: navigator.userAgent, platform: navigator.platform,
    cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory ?? null,
    touch: navigator.maxTouchPoints, langs: (navigator.languages || []).join(','),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    gpu: null, canvas: null,
    lies: null,
  };
  try {
    const d = navigator.userAgentData;
    o.gpu = d ? (await d.getHighEntropyValues(['architecture','bitness','platformVersion'])).architecture ?? 'null-arch' : 'absent';
  } catch { o.gpu = 'err'; }
  try {
    const c = document.createElement('canvas'); c.width = 200; c.height = 50;
    const ctx = c.getContext('2d'); draw(ctx);
    const px = ctx.getImageData(0, 0, 200, 50).data;
    let h = 0; for (let i = 0; i < px.length; i++) h = (h * 31 + px[i]) | 0;
    o.canvas = String(h >>> 0);
  } catch (err) { o.canvas = "err:" + err.message; }
  // Classic tells an antifraud script checks in two lines. native here means the property still
  // behaves like the engine's own; anything else is a modification the page can see.
  try {
    const d = Object.getOwnPropertyDescriptor(Function.prototype, 'toString');
    const t = Function.prototype.toString;
    o.lies = {
      toStringOwnValue: Object.prototype.hasOwnProperty.call(Function.prototype, 'toString') &&
        !!d && typeof d.value === 'function',
      toStringSource: String(t).slice(0, 60),
      navCoresDesc: (() => { const x = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency'); return x ? 'proto' : 'own/none'; })(),
      uaDataOwnOnNav: Object.prototype.hasOwnProperty.call(navigator, 'userAgentData'),
    };
  } catch (e) { o.lies = { err: String(e) }; }
  return o;
})()`;

const WORKER_BODY = `(${function () {
  const draw = (ctx) => {
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 200, 25);
    ctx.fillStyle = '#069'; ctx.fillText('NullTrace parity probe', 2, 2);
  };
  async function snap() {
    const o = {
      ua: self.navigator.userAgent, platform: self.navigator.platform,
      cores: self.navigator.hardwareConcurrency, memory: self.navigator.deviceMemory ?? null,
      touch: self.navigator.maxTouchPoints, langs: (self.navigator.languages || []).join(','),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      gpu: null, canvas: null,
      hasDocument: typeof document !== 'undefined',
      plugins: null, mimeCount: null, notifPerm: null, batt: null,
      mediaCount: null, connType: null, voices: null, webgpuVendor: null,
    };
    try {
      const d = self.navigator.userAgentData;
      o.gpu = d ? (await d.getHighEntropyValues(['architecture','bitness','platformVersion'])).architecture ?? 'null-arch' : 'absent';
    } catch { o.gpu = 'err'; }
    // Surfaces the JS layer overrides: measured in a worker, where only the kernel can reach.
    try { o.plugins = self.navigator.plugins ? self.navigator.plugins.length : 'absent'; } catch { o.plugins = 'n/a'; }
    try { o.mimeCount = self.navigator.mimeTypes ? self.navigator.mimeTypes.length : 'absent'; } catch { o.mimeCount = 'n/a'; }
    try {
      const st = await self.navigator.permissions.query({ name: 'notifications' });
      o.notifPerm = st.state;
    } catch { o.notifPerm = 'n/a'; }
    try { o.batt = self.navigator.getBattery ? 'present' : 'absent'; } catch { o.batt = 'n/a'; }
    try {
      const ds = await self.navigator.mediaDevices.enumerateDevices();
      o.mediaCount = ds.length;
    } catch { o.mediaCount = 'n/a'; }
    try { o.connType = self.navigator.connection ? self.navigator.connection.effectiveType : 'absent'; } catch { o.connType = 'n/a'; }
    try { o.voices = typeof self.speechSynthesis !== 'undefined' ? 'present' : 'absent'; } catch { o.voices = 'n/a'; }
    try {
      if (self.navigator.gpu && self.navigator.gpu.requestAdapter) {
        const ad = await self.navigator.gpu.requestAdapter();
        o.webgpuVendor = ad ? 'adapter' : 'null';
      } else { o.webgpuVendor = 'absent'; }
    } catch (err) { o.webgpuVendor = 'err:' + err.message; }
    try {
      const c = new OffscreenCanvas(200, 50);
      const ctx = c.getContext('2d'); draw(ctx);
      const px = ctx.getImageData(0, 0, 200, 50).data;
      let h = 0; for (let i = 0; i < px.length; i++) h = (h * 31 + px[i]) | 0;
      o.canvas = String(h >>> 0);
    } catch (err) { o.canvas = "err:" + err.message; }
    return o;
  }
  self.onmessage = async () => { self.postMessage(await snap()); };
}.toString()})()`;

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Controls: NT_NO_EXT=1 drops the JS layer, NT_NO_KERNEL=1 drops the kernel flags. The truth
// table these two switches produce is what separates "the layers disagree" from "workers differ
// from the main thread for some unrelated reason".
const useExt = process.env.NT_NO_EXT !== '1';
const useKernel = process.env.NT_NO_KERNEL !== '1';
// Space-separated extra switches, so a candidate kernel flag can be tested without editing this
// file: NT_EXTRA_FLAGS="--fingerprint-device-memory=4" node scripts/probe-stealth-contexts.mjs
const extraFlags = (process.env.NT_EXTRA_FLAGS ?? '').split(' ').filter(Boolean);
const args = [
  ...(useKernel ? [`--fingerprint=${SEED}`, '--fingerprint-platform=macos', `--fingerprint-hardware-concurrency=${stealthOpts.hardwareConcurrency}`] : []),
  ...extraFlags,
  ...(useExt ? [`--load-extension=${extDir}`, `--disable-extensions-except=${extDir}`] : []),
  `--user-data-dir=${userDataDir}`,
  '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check',
  origin,
];
const child = spawn(EXE, args, { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));

const portFile = path.join(userDataDir, 'DevToolsActivePort');
let wsUrl = null;
for (let i = 0; i < 120; i++) {
  // Chromium writes DevToolsActivePort while it is still starting; a read can land mid-write and
  // fail with EBUSY/EACCES on Windows, or return a file whose second line is not there yet.
  // Treating that as fatal made the probe flaky — it is a retry, not an error.
  try {
    if (fs.existsSync(portFile)) {
      const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
      if (port && port.trim()) {
        const list = await fetchJson(`http://127.0.0.1:${port.trim()}/json/list`);
        const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
        if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
      }
    }
  } catch { /* file locked or endpoint not up yet — keep polling */ }
  await new Promise((r) => setTimeout(r, 250));
}
if (!wsUrl) {
  console.error(`no CDP endpoint; stderr tail:\n${stderr.slice(-600)}`);
  child.kill(); server.close(); process.exit(1);
}

const { default: WS } = await import('ws');
const ws = new WS(wsUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));
let id = 0; const pending = new Map();
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

// Let the content script at document_start install itself.
await new Promise((r) => setTimeout(r, 1500));

const main = await evaluate(MAIN_PROBE);
const worker = await evaluate(`new Promise((resolve) => {
  const blob = new Blob([${JSON.stringify(WORKER_BODY)}], { type: 'application/javascript' });
  const w = new Worker(URL.createObjectURL(blob));
  w.onmessage = (e) => { resolve(e.data); w.terminate(); };
  w.onerror = (e) => resolve({ __error: String(e.message) });
  w.postMessage('go');
})`);

ws.close(); child.kill(); server.close();
await new Promise((r) => setTimeout(r, 400));
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const KEYS = ['ua', 'platform', 'cores', 'memory', 'langs', 'tz', 'gpu', 'canvas'];
const WORKER_ONLY = ['plugins', 'mimeCount', 'notifPerm', 'batt', 'mediaCount', 'connType', 'voices', 'webgpuVendor'];
console.log(`\n=== MAIN vs WORKER | kernel=${useKernel ? `on(seed ${SEED})` : 'OFF'} | js-layer=${useExt ? 'on' : 'OFF'} ===\n`);
console.log(`${'surface'.padEnd(14)}${'MAIN'.padEnd(30)}WORKER`);
console.log('-'.repeat(84));
let diverged = 0;
for (const k of KEYS) {
  const a = String(main?.[k] ?? '-'); const b = String(worker?.[k] ?? '-');
  const same = a === b; if (!same) diverged++;
  const t = (s) => (s.length > 28 ? `${s.slice(0, 25)}...` : s);
  console.log(k.padEnd(14) + t(a).padEnd(30) + t(b) + (same ? '' : '   <-- DIVERGES'));
}
console.log(`WORKER-ONLY surfaces (kernel coverage visible where the JS layer cannot reach):`);
for (const k of WORKER_ONLY) console.log(`  ${k.padEnd(14)}${String(worker?.[k] ?? '-')}`);
console.log(`\ntouch: main=${String(main?.touch ?? '-')} worker=${String(worker?.touch ?? '-')} (WorkerNavigator has no maxTouchPoints by spec — not a leak)`);
console.log(`\nJS-layer tells on the MAIN thread — what a page reads in two lines:`);
console.log(JSON.stringify(main?.lies ?? { unavailable: main?.__error ?? 'unknown' }, null, 2));
console.log(`DIVERGED: ${diverged}/${KEYS.length}`);
console.log(`Host truth: platform=${process.platform} (win32), cores=${os.cpus().length}`);
