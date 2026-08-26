import puppeteer from 'puppeteer-core';

const CHROME = 'D:\\WORK\\antidetect browser\\data\\chromium\\fingerprint-chromium\\ungoogled-chromium_148.0.7778.215-1.1_windows_x64\\chrome.exe';
const API_KEY = process.env.ANTIDETECT_API_KEY || '';
const APP = 'http://localhost:5173/';

async function main(): Promise<void> {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1280, height: 760 },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  await page.evaluateOnNewDocument((k) => localStorage.setItem('apiKey', k), API_KEY);
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.app', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1200));

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // go to Settings
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.textContent?.includes('Settings'));
    (b as HTMLElement)?.click();
  });
  await new Promise((r) => setTimeout(r, 900));

  const sections = ['General', 'Automation API', 'Data Folder', 'Updates', 'Diagnostics'];
  for (const s of sections) {
    const clicked = await page.evaluate((label) => {
      const b = Array.from(document.querySelectorAll('.settings-nav-item')).find((x) => x.textContent?.includes(label));
      if (!b) return 'not found';
      (b as HTMLElement).click();
      return 'ok';
    }, s);
    await new Promise((r) => setTimeout(r, 500));
    const check = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        overflowX: doc.scrollWidth > doc.clientWidth,
        offscreen: Array.from(document.querySelectorAll('*')).filter((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
        }).length,
      };
    });
    console.log(`${s}: nav=${clicked}, overflowX=${check.overflowX}, offscreen=${check.offscreen}`);
  }

  // Profiles table actions fit check at 1280px
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.textContent?.includes('Profiles'));
    (b as HTMLElement)?.click();
  });
  await new Promise((r) => setTimeout(r, 900));
  const actionsFit = await page.evaluate(() => {
    const rows = document.querySelectorAll('tbody tr');
    if (rows.length === 0) return 'no rows';
    const first = rows[0];
    const tds = first.querySelectorAll('td');
    const last = tds[tds.length - 1];
    const r = last.getBoundingClientRect();
    return `last cell right=${Math.round(r.right)} viewport=${window.innerWidth} fits=${r.right <= window.innerWidth}`;
  });
  console.log('PROFILES ACTIONS FIT:', actionsFit);
  console.log('PAGE ERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
