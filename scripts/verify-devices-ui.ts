import puppeteer from 'puppeteer-core';
import * as fs from 'fs';

const CHROME = 'D:\\WORK\\antidetect browser\\data\\chromium\\fingerprint-chromium\\ungoogled-chromium_148.0.7778.215-1.1_windows_x64\\chrome.exe';
const APP = 'http://localhost:5173/';
const KEY = fs.readFileSync('D:/WORK/antidetect browser/data/api_key', 'utf8').trim();

async function main(): Promise<void> {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1280, height: 760 },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  await page.evaluateOnNewDocument((k) => {
    localStorage.setItem('apiKey', k);
    localStorage.setItem('lang', 'en');
    localStorage.setItem('apiBase', 'http://127.0.0.1:50341');
  }, KEY);
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.app', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2000));

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.textContent?.includes('Devices'));
    (b as HTMLElement)?.click();
  });
  await new Promise((r) => setTimeout(r, 1200));

  const res = await page.evaluate(() => {
    const copyButtons = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.includes('Copy ID')).length;
    const applyButtons = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.includes('Apply to Profile')).length;
    const phoneRows = document.querySelectorAll('table tbody tr').length;
    // click first Copy ID and check clipboard feedback
    const copyBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Copy ID')) as HTMLElement | undefined;
    copyBtn?.click();
    return { copyButtons, applyButtons, phoneRows, overflowX: document.documentElement.scrollWidth > document.clientWidth };
  });
  await new Promise((r) => setTimeout(r, 300));
  const copied = await page.evaluate(() => Boolean(document.querySelector('button')?.textContent?.includes('Copied!')) || undefined);
  const scroll = await page.evaluate(() => { const el = document.querySelector('.content') as HTMLElement; if (!el) return 'no .content'; const before = el.scrollTop; el.scrollTop = 99999; return { scrollable: el.scrollHeight > el.clientHeight, scrolledTo: el.scrollTop, before }; });
  console.log('DEVICES PAGE:', JSON.stringify({ ...res, copiedFeedback: copied }));
  console.log('SCROLL:', JSON.stringify(scroll));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
