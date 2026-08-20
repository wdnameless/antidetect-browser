// Probe: find the exact CDP userAgentMetadata shape that Chromium 148 accepts.
// Run: npx tsx scripts/probe-ua-metadata.ts
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

function baseMetadata(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
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
      { brand: 'Not.A.Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: '148.0.7778.215' },
      { brand: 'Google Chrome', version: '148.0.7778.215' },
      { brand: 'Not.A.Brand', version: '24.0.0.0' },
    ],
    ...overrides,
  };
}

async function probe(label: string, metadata: Record<string, unknown>): Promise<void> {
  const dir = path.join('data', 'audit-tmp', 'ua-' + label.replace(/[^a-z0-9]/gi, ''));
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
  if (!port) { child.kill(); console.log(label, 'NO PORT'); return; }
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    const session = await page.createCDPSession();
    try {
      await session.send('Emulation.setUserAgentOverride', { userAgent: UA_MOBILE, userAgentMetadata: metadata });
      await page.goto('about:blank');
      const s = await page.evaluate(`({
        ua: navigator.userAgent,
        uaData: navigator.userAgentData ? JSON.stringify(navigator.userAgentData) : 'null',
        secChUa: null,
      })`);
      console.log('OK  ', label, JSON.stringify(s));
    } catch (e) {
      console.log('FAIL', label, (e as Error).message.split('\n')[0]);
    }
  } finally {
    browser.disconnect();
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main(): Promise<void> {
  await probe('full', baseMetadata({}));
  await probe('no-full-version', baseMetadata({ fullVersion: undefined }));
  await probe('no-wow64', baseMetadata({ wow64: undefined }));
  await probe('no-formfactors', baseMetadata({ formFactors: undefined }));
  await probe('no-model', baseMetadata({ model: undefined }));
  await probe('no-arch', baseMetadata({ architecture: undefined }));
  await probe('no-bitness', baseMetadata({ bitness: undefined }));
  await probe('no-platform-version', baseMetadata({ platformVersion: undefined }));
  await probe('no-brands', baseMetadata({ brands: undefined }));
  await probe('no-full-version-list', baseMetadata({ fullVersionList: undefined }));
  await probe('no-mobile', baseMetadata({ mobile: undefined }));
  await probe('no-platform', baseMetadata({ platform: undefined }));
}

main().catch((e) => { console.error(e); process.exit(1); });
