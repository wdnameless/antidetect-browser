// Verify Phase 1 (Selenium chromedriver path) + Phase 2 (start_urls on start).
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/verify-selenium-starturls.ts
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
    body: JSON.stringify({ name: 'verify-sel-urls', start_urls: ['https://example.com/', 'https://example.org/'] }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  if (!id) throw new Error('create failed: ' + JSON.stringify(created));

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (started?.code !== 0) throw new Error('start failed: ' + started?.msg);

  const webdriverPath: string = started.data.webdriver ?? '';
  console.log('webdriver path:', webdriverPath || '(empty)');
  console.log('PHASE1 (chromedriver path present):', webdriverPath.length > 0 ? 'PASS' : 'FAIL');

  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const pages = await browser.pages();
    const urls = pages.map((p) => p.url()).filter((u) => u.startsWith('http'));
    console.log('open urls:', urls);
    const hasFirst = urls.some((u) => u.includes('example.com'));
    const hasSecond = urls.some((u) => u.includes('example.org'));
    console.log('PHASE2 (start_urls opened):', hasFirst && hasSecond ? 'PASS' : 'FAIL');
  } finally {
    browser.disconnect();
  }
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  process.exit(0);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
