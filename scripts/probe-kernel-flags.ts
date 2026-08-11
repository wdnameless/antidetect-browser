// Quick probe: does kernel spoofing engage with explicit flags?
// Run: npx tsx scripts/probe-kernel-flags.ts
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer-core';

const KERNEL = path.join(
  'data', 'chromium', 'fingerprint-chromium',
  'ungoogled-chromium_148.0.7778.215-1.1_windows_x64', 'chrome.exe'
);

async function probe(label: string, extraArgs: string[]): Promise<void> {
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
    await page.goto('about:blank');
    const s = await page.evaluate(`({
      platform: navigator.platform,
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      mem: navigator.deviceMemory ?? -1,
      uaData: navigator.userAgentData ? 'present' : 'null',
      webdriver: navigator.webdriver,
    })`);
    console.log(label, JSON.stringify(s));
  } finally {
    browser.disconnect();
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main(): Promise<void> {
  await probe('explicit-flags', [
    '--fingerprint=123456789',
    '--fingerprint-platform=windows',
    '--fingerprint-brand=Chrome',
    '--fingerprint-hardware-concurrency=8',
    '--timezone=America/New_York',
    '--lang=en-US',
  ]);
  await probe('seed-only', ['--fingerprint=123456789']);
  await probe('no-flags', []);
}

main().catch((e) => { console.error(e); process.exit(1); });
