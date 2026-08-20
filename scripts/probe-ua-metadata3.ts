// Probe 3: kernel descriptors for userAgentData/chrome/plugins/deviceMemory with mobile UA.
// Run: npx tsx scripts/probe-ua-metadata3.ts
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer-core';

const KERNEL = path.join(
  'data', 'chromium', 'fingerprint-chromium',
  'ungoogled-chromium_148.0.7778.215-1.1_windows_x64', 'chrome.exe'
);

const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36';

async function main(): Promise<void> {
  const dir = path.join('data', 'audit-tmp', 'ua3');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    `--user-data-dir=${path.resolve(dir)}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  const child = spawn(path.resolve(KERNEL), args, { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  const deadline = Date.now() + 25000;
  let port = '', wsPath = '';
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      const lines = fs.readFileSync(portFile, 'utf8').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length >= 2) { port = lines[0].trim(); wsPath = lines[1].trim(); break; }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!port) { child.kill(); console.log('NO PORT'); return; }
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    const session = await page.createCDPSession();
    await session.send('Emulation.setUserAgentOverride', { userAgent: UA_MOBILE });
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const s = await page.evaluate(`(() => {
      const nav = navigator;
      const descNav = Object.getOwnPropertyDescriptor(nav, 'userAgentData');
      const descProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgentData');
      const chromeObj = window.chrome ? {
        keys: Object.keys(window.chrome),
        hasRuntime: !!window.chrome.runtime,
        hasLoadTimes: !!window.chrome.loadTimes,
        hasCsi: !!window.chrome.csi,
        hasApp: !!window.chrome.app,
      } : null;
      return {
        uaDataDescNav: descNav ? { configurable: descNav.configurable, enumerable: descNav.enumerable, hasGet: !!descNav.get, hasValue: 'value' in descNav } : null,
        uaDataDescProto: descProto ? { configurable: descProto.configurable, enumerable: descProto.enumerable, hasGet: !!descProto.get, hasValue: 'value' in descProto } : null,
        chrome: chromeObj,
        plugins: Array.from(navigator.plugins).map(p => p.name),
        pluginCount: navigator.plugins.length,
        mimeCount: navigator.mimeTypes.length,
        deviceMemory: nav.deviceMemory,
        languages: navigator.languages,
        platform: navigator.platform,
        vendor: navigator.vendor,
        maxTouchPoints: navigator.maxTouchPoints,
        webdriver: nav.webdriver,
        hardwareConcurrency: nav.hardwareConcurrency,
        permissionsQuery: (async () => {
          try {
            const r = await navigator.permissions.query({ name: 'notifications' });
            return r.state;
          } catch (e) { return 'err:' + e.message; }
        })(),
      };
    })()`);
    console.log(JSON.stringify(s, null, 2));
  } finally {
    browser.disconnect();
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
