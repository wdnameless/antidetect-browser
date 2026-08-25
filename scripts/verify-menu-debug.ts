import puppeteer from 'puppeteer-core';
import * as fs from 'fs';

const CHROME = 'D:\\WORK\\antidetect browser\\data\\chromium\\fingerprint-chromium\\ungoogled-chromium_148.0.7778.215-1.1_windows_x64\\chrome.exe';
const APP = 'http://localhost:5173/';

async function main(): Promise<void> {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1280, height: 760 },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('apiKey', fs.readFileSync('D:/WORK/antidetect browser/data/api_key', 'utf8').trim());
    localStorage.setItem('lang', 'en');
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.app', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 2500));
  const info = await page.evaluate(() => ({
    rows: document.querySelectorAll('tbody tr').length,
    kebabByTitle: document.querySelectorAll('button[title="More actions"]').length,
    kebabByText: Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.trim() === '⋯').length,
    bodySnippet: document.body.innerText.slice(0, 200),
  }));
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
