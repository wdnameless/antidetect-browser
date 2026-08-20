// Probe 2: formFactors variants + uaData on real page + system Chrome comparison.
// Run: npx tsx scripts/probe-ua-metadata2.ts
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

async function probe(label: string, metadata: Record<string, unknown>, navigate = false): Promise<void> {
  const dir = path.join('data', 'audit-tmp', 'ua2-' + label.replace(/[^a-z0-9]/gi, ''));
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
      if (navigate) {
        await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      } else {
        await page.goto('about:blank');
      }
      const s = await page.evaluate(`({
        ua: navigator.userAgent,
        uaData: navigator.userAgentData ? JSON.stringify(navigator.userAgentData) : 'null',
        platform: navigator.platform,
        vendor: navigator.vendor,
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
  await probe('ff-mobile-tablet', baseMetadata({ formFactors: ['mobile', 'tablet'] }));
  await probe('ff-desktop', baseMetadata({ formFactors: ['desktop'] }));
  await probe('ff-empty', baseMetadata({ formFactors: [] }));
  await probe('ff-tablet', baseMetadata({ formFactors: ['tablet'] }));
  await probe('ff-xr', baseMetadata({ formFactors: ['xr'] }));
  await probe('ff-mobile-desktop', baseMetadata({ formFactors: ['mobile', 'desktop'] }));
  await probe('no-ff-realpage', baseMetadata({}), true);
  await probe('no-ff-aboutblank', baseMetadata({}));
}

main().catch((e) => { console.error(e); process.exit(1); });
