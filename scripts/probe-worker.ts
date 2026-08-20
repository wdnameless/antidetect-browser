// Check worker-scope UA (creepjs headless 33% source).
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-worker.ts
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
    body: JSON.stringify({ name: 'probe-worker' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });

    const res = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        const w = new Worker(URL.createObjectURL(new Blob(['self.postMessage({ua: navigator.userAgent, uaData: navigator.userAgentData ? JSON.stringify(navigator.userAgentData) : null, webdriver: navigator.webdriver, platform: navigator.platform})'], { type: 'text/javascript' })));
        w.onmessage = (e) => { resolve(e.data); w.terminate(); };
        w.onerror = (e) => resolve({ error: String(e.message) });
      });
    });
    console.log('worker signals:', JSON.stringify(res, null, 2));
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
