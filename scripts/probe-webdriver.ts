// Check how webdriver is defined (own property vs prototype) and what creepjs sees.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-webdriver.ts
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
    body: JSON.stringify({ name: 'probe-webdriver' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });

    const res = await page.evaluate(() => {
      const own = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
      const proto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
      const reflectOwn = Reflect.getOwnPropertyDescriptor(navigator, 'webdriver');
      return {
        value: navigator.webdriver,
        ownDescriptor: own ? { configurable: own.configurable, enumerable: own.enumerable, hasGet: !!own.get, value: own.value } : null,
        protoDescriptor: proto ? { configurable: proto.configurable, enumerable: proto.enumerable, hasGet: !!proto.get, value: proto.value } : null,
        reflectOwn: !!reflectOwn,
        ownKeys: Object.getOwnPropertyNames(navigator).filter((k) => k.toLowerCase().includes('webdriver')),
      };
    });
    console.log(JSON.stringify(res, null, 2));
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
