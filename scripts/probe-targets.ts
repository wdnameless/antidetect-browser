// Debug: list page targets at connect time, inject into ALL, navigate, read.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-targets.ts
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
    body: JSON.stringify({ name: 'probe-targets', device_id: 'dev_android' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  console.log('created', id);

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  console.log('start code', started?.code, started?.msg ?? '');

  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const t0 = await browser.targets();
    console.log('targets at connect:', t0.map((t) => `${t.type()} ${t.url()}`));

    // Inject into ALL page targets
    for (const t of t0.filter((t) => t.type() === 'page')) {
      const s = await t.createCDPSession();
      await s.send('Page.addScriptToEvaluateOnNewDocument', { source: buildStealthScript({ mobile: true, logicalPlatform: 'android', model: 'Pixel 8' }) });
      console.log('injected into', t.url());
    }

    const pages = await browser.pages();
    console.log('pages count', pages.length, pages.map((p) => p.url()));
    const page = pages[0];
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const res = await page.evaluate(() => ({
      runtime: !!window.chrome?.runtime,
      webstore: !!window.chrome?.webstore,
      uaData: navigator.userAgentData ? JSON.stringify(navigator.userAgentData) : null,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      orientation: screen.orientation?.type,
      plugins: navigator.plugins.length,
    }));
    console.log('signals on pages[0]:', JSON.stringify(res, null, 2));

    const t1 = await browser.targets();
    console.log('targets after nav:', t1.map((t) => `${t.type()} ${t.url()}`));
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
