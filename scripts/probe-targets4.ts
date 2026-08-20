// Test: register script on a NORMAL page (about:blank) vs WebUI newtab, then navigate.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-targets4.ts
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
    body: JSON.stringify({ name: 'probe-targets4', device_id: 'dev_android' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    console.log('initial url:', page.url());

    // Navigate to about:blank FIRST (normal page), then register
    await page.goto('about:blank');
    console.log('after about:blank, url:', page.url());
    const session = await page.createCDPSession();
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildStealthScript({ mobile: true, logicalPlatform: 'android', model: 'Pixel 8' }),
    });
    console.log('script registered on about:blank target');

    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const res = await page.evaluate(() => ({
      runtime: !!window.chrome?.runtime,
      webstore: !!window.chrome?.webstore,
      uaDataMobile: navigator.userAgentData ? navigator.userAgentData.mobile : null,
      uaDataPlatform: navigator.userAgentData ? navigator.userAgentData.platform : null,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      plugins: navigator.plugins.length,
    }));
    console.log('signals after about:blank-registered script:', JSON.stringify(res));
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
