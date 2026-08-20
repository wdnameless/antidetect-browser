// Decisive: does the kernel accept Page.addScriptToEvaluateOnNewDocument? Does the script run at all?
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-targets5.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'probe-targets5', device_id: 'dev_android' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    await page.goto('about:blank');
    const session = await page.createCDPSession();

    // 1) Register a trivial flag script
    const resp1 = await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__stealthRan = 1;',
    });
    console.log('addScriptToEvaluateOnNewDocument response:', JSON.stringify(resp1));

    // 2) Register the full stealth script too
    const resp2 = await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__stealthRan2 = 2;',
    });
    console.log('second registration response:', JSON.stringify(resp2));

    // 3) Navigate and check flags
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const flags = await page.evaluate(() => ({
      ran1: window.__stealthRan,
      ran2: window.__stealthRan2,
      runtime: !!window.chrome?.runtime,
    }));
    console.log('flags after nav:', JSON.stringify(flags));

    // 4) Try Page.addScriptToEvaluateOnLoad (runs on every load, after document scripts)
    const resp3 = await session.send('Page.addScriptToEvaluateOnLoad', {
      source: 'window.__stealthOnLoad = 3;',
    });
    console.log('addScriptToEvaluateOnLoad response:', JSON.stringify(resp3));
    await page.goto('https://example.org/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const flags2 = await page.evaluate(() => ({
      ran1: window.__stealthRan,
      ran2: window.__stealthRan2,
      onLoad: window.__stealthOnLoad,
    }));
    console.log('flags after 2nd nav:', JSON.stringify(flags2));
  } finally {
    browser.disconnect();
  }
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  process.exit(0);
}

main().catch((err) => {
  console.error('PROBE FAILED', err);
  process.exit(1);
});
