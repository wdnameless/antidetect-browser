// Probe 2: platform=macos, timezone, and CDP userAgentMetadata behavior.
// Run: npx tsx scripts/probe-kernel-flags2.ts
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer-core';

const KERNEL = path.join(
  'data', 'chromium', 'fingerprint-chromium',
  'ungoogled-chromium_148.0.7778.215-1.1_windows_x64', 'chrome.exe'
);

async function probe(label: string, extraArgs: string[], cdpUa?: { ua: string; metadata?: unknown }): Promise<void> {
  const dir = path.join('data', 'audit-tmp', label);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    `--user-data-dir=${path.resolve(dir)}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    ...extraArgs,
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
  if (!port) { child.kill(); console.log(label, 'NO PORT'); return; }
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    if (cdpUa) {
      const session = await page.createCDPSession();
      await session.send('Emulation.setUserAgentOverride', cdpUa);
    }
    await page.goto('about:blank');
    const s = await page.evaluate(`({
      platform: navigator.platform,
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      uaData: navigator.userAgentData ? JSON.stringify(navigator.userAgentData) : 'null',
    })`);
    console.log(label, JSON.stringify(s));
  } finally {
    browser.disconnect();
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main(): Promise<void> {
  await probe('platform-macos', [
    '--fingerprint=123456789',
    '--fingerprint-platform=macos',
    '--fingerprint-hardware-concurrency=8',
  ]);
  await probe('timezone-test', [
    '--fingerprint=123456789',
    '--timezone=America/New_York',
  ]);
  await probe('cdp-ua-metadata', [], {
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
    metadata: {
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: 'arm',
      bitness: '64',
      wow64: false,
      model: 'Pixel 8',
      mobile: true,
      formFactors: ['mobile'],
      fullVersion: '148.0.7778.215',
      brands: [
        { brand: 'Chromium', version: '148' },
        { brand: 'Google Chrome', version: '148' },
        { brand: 'Not(A:Brand)', version: '24' },
      ],
      fullVersionList: [
        { brand: 'Chromium', version: '148.0.7778.215' },
        { brand: 'Google Chrome', version: '148.0.7778.215' },
        { brand: 'Not(A:Brand)', version: '24.0.0.0' },
      ],
    },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
