// Decisive: does the page target get REPLACED (new targetId) on navigation?
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-targets3.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';
import { buildStealthScript } from '../src/main/proxy/stealthInjection';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'probe-targets3', device_id: 'dev_android' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    const t0 = page.target();
    console.log('initial targetId:', t0._targetId, 'url:', page.url());

    // Register script on the current target
    const session = await page.createCDPSession();
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildStealthScript({ mobile: true, logicalPlatform: 'android', model: 'Pixel 8' }),
    });
    console.log('script registered on target', t0._targetId);

    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const t1 = page.target();
    console.log('after nav targetId:', t1._targetId, 'url:', page.url());
    console.log('target replaced:', t0._targetId !== t1._targetId);

    const res = await page.evaluate(() => ({
      runtime: !!window.chrome?.runtime,
      uaDataMobile: navigator.userAgentData ? navigator.userAgentData.mobile : null,
      maxTouchPoints: navigator.maxTouchPoints,
    }));
    console.log('signals:', JSON.stringify(res));

    // Now register on the CURRENT (post-swap) target and navigate again
    const session2 = await page.createCDPSession();
    await session2.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildStealthScript({ mobile: true, logicalPlatform: 'android', model: 'Pixel 8' }),
    });
    await page.goto('https://example.org/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const t2 = page.target();
    console.log('after 2nd nav targetId:', t2._targetId, 'replaced again:', t1._targetId !== t2._targetId);
    const res2 = await page.evaluate(() => ({
      runtime: !!window.chrome?.runtime,
      uaDataMobile: navigator.userAgentData ? navigator.userAgentData.mobile : null,
      maxTouchPoints: navigator.maxTouchPoints,
    }));
    console.log('signals2:', JSON.stringify(res2));
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
