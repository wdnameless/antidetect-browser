// Phase 0 automation smoke test: start a profile via the Local API, then drive it
// with puppeteer-core over the returned CDP endpoint (the user's #1 priority).
// Run: $env:ANTIDETECT_DATA_DIR="<temp>"; npx tsx scripts/smoke-automation.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  };

  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'auto-test' }),
  }).then((r) => r.json());
  const profileId: string = created?.data?.user_id;
  if (!profileId) throw new Error('create failed: ' + JSON.stringify(created));

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${profileId}`, { headers }).then((r) =>
    r.json()
  );
  if (started?.code !== 0) throw new Error('start failed: ' + started?.msg);
  const wsEndpoint: string = started.data.ws.puppeteer;
  console.log('CDP endpoint from API:', wsEndpoint);

  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());
  await page.goto('about:blank');

  const info = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    language: navigator.language,
    webdriver: (navigator as { webdriver?: boolean }).webdriver,
  }));
  console.log('PROFILE CONTEXT VIA AUTOMATION:');
  console.log(JSON.stringify(info, null, 2));

  console.log('AUTOMATION OK');
  browser.disconnect();
  await fetch(`${base}/api/v1/browser/stop?user_id=${profileId}`, { headers });
  process.exit(0);
}

main().catch((err) => {
  console.error('AUTOMATION FAILED', err);
  process.exit(1);
});
