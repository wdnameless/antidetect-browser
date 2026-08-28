import puppeteer from 'puppeteer-core';
import * as fs from 'fs';

const CHROME = process.env.CHROMIUM_PATH || '';
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
  await new Promise((r) => setTimeout(r, 2500));

  // open the kebab of the first row
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[title="More actions"]'))[0];
    if (!btn) return 'no kebab';
    (btn as HTMLElement).click();
    return 'ok';
  });
  await new Promise((r) => setTimeout(r, 500));

  const check = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('div')).filter((d) => {
      const s = getComputedStyle(d);
      return s.position === 'fixed' && parseInt(s.zIndex) === 100 && d.textContent?.includes('Duplicate Profile');
    });
    if (candidates.length === 0) return { found: false };
    const m = candidates[candidates.length - 1].getBoundingClientRect();
    return {
      found: true,
      top: Math.round(m.top),
      bottom: Math.round(m.bottom),
      right: Math.round(m.right),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      fullyVisible: m.top >= 0 && m.bottom <= window.innerHeight && m.right <= window.innerWidth,
      items: (candidates[candidates.length - 1].textContent || '').match(/(Duplicate|Randomize|Cookies|Fingerprint|Extensions|Delete)/g),
    };
  });
  console.log('kebab click:', clicked);
  console.log('MENU:', JSON.stringify(check));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
