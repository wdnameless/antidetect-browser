import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROMIUM_PATH || '';
const API_KEY = process.env.ANTIDETECT_API_KEY || '';
const OUT = process.env.OUT_DIR || require('os').tmpdir();
const APP = 'http://localhost:5173/';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  await page.evaluateOnNewDocument((key) => {
    localStorage.setItem('apiKey', key);
  }, API_KEY);

  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.app, .sidebar', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));

  const report: string[] = [];

  async function checkPage(label: string) {
    const info = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflowX = doc.scrollWidth > doc.clientWidth;
      const hidden = Array.from(document.querySelectorAll('*')).filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
      }).slice(0, 5).map((el) => `${el.tagName}.${(el as HTMLElement).className}`);
      return { overflowX, hidden };
    });
    report.push(`== ${label} == overflowX: ${info.overflowX}, offscreen: ${JSON.stringify(info.hidden)}`);
  }

  // Navigate to Profiles
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.textContent?.includes('Profiles'));
    (b as HTMLElement)?.click();
  });
  await new Promise((r) => setTimeout(r, 1200));

  // Open New Profile modal
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.includes('New Profile'));
    (b as HTMLElement)?.click();
  });
  await new Promise((r) => setTimeout(r, 1000));

  // Switch to Fingerprint tab
  const tabsInfo = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.tab-btn')).map((t) => t.textContent?.trim())
  );
  console.log('tabs:', JSON.stringify(tabsInfo));
  const clickedTab = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.tab-btn'));
    const t = tabs.find((x) => x.textContent?.includes('Fingerprint'));
    if (!t) return 'no tab found';
    (t as HTMLElement).click();
    return 'ok';
  });
  console.log('tab click:', clickedTab);
  await new Promise((r) => setTimeout(r, 1000));
  await checkPage('profile-modal-fingerprint');
  const fpChecks = await page.evaluate(() => {
    const modal = document.querySelector('.modal-card');
    if (!modal) return { modalOpen: false };
    const text = (modal as HTMLElement).innerText;
    const gpuItems = Array.from(modal.querySelectorAll('.fp-item'))
      .map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
      .filter((t) => t.includes('GPU'));
    return {
      modalOpen: true,
      hasGpuLabel: text.replace(/\s+/g, ' ').includes('GPU (WebGL)'),
      hasAngled: text.includes('ANGLE'),
      gpuItems: gpuItems,
      hasManualSeed: text.includes('Fingerprint Seed (manual)'),
      hasRandomize: text.includes('Randomize Seed'),
      hasPhoneModel: text.includes('Phone Model (fixed)'),
    };
  });
  report.push('MODAL FP CHECKS: ' + JSON.stringify(fpChecks));

  // Close modal
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.modal-footer button')).find((x) => x.textContent?.trim() === 'Cancel');
    (b as HTMLElement)?.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  // Go to Proxies, open Add Proxy modal
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.textContent?.includes('Proxies'));
    (b as HTMLElement)?.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.includes('Add Proxy'));
    (b as HTMLElement)?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await checkPage('proxy-modal');
  const proxyModalText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  fs.writeFileSync(`${OUT}\\proxy-modal.txt`, proxyModalText, 'utf8');
  report.push('PROXY MODAL contains protocol options: ' + proxyModalText.includes('SOCKS5'));

  report.push('CONSOLE ERRORS: ' + (consoleErrors.length ? consoleErrors.join(' | ') : 'none'));
  console.log(report.join('\n'));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
