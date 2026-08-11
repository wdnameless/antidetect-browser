// Best-effort external detector validation (pixelscan / browserscan).
// Launches a profile, navigates to detector pages, waits, and captures the verdict text.
// These sites may be Cloudflare-protected or slow; results are best-effort.
// Run: $env:API_PORT="50344"; npx tsx scripts/verify-detectors.ts
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
    body: JSON.stringify({ name: 'detector-test' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);

  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());

    const targets = [
      { name: 'pixelscan', url: 'https://pixelscan.net/fingerprint-check' },
      { name: 'browserscan', url: 'https://www.browserscan.net/' },
    ];

    for (const t of targets) {
      console.log(`\n=== ${t.name} (${t.url}) ===`);
      try {
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise((r) => setTimeout(r, 12000)); // let detector JS run
        const title = await page.title().catch(() => '(no title)');
        const text = await page
          .evaluate(() => (document.body ? document.body.innerText : ''))
          .catch(() => '');
        const snippet = text.replace(/\s+/g, ' ').slice(0, 600);
        console.log('title:', title);
        console.log('text:', snippet || '(empty — likely blocked/Cloudflare or still loading)');
      } catch (err) {
        console.log('navigation failed:', (err as Error).message);
      }
    }
  } finally {
    browser.disconnect();
    await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('DETECTOR TEST FAILED', err);
  process.exit(1);
});
