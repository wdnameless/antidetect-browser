// Benchmark run with clicks: EFF Cover Your Tracks + pixelscan (need button clicks).
// Run: $env:CHROMIUM_PATH="<kernel chrome.exe>"; $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50363"; npx tsx scripts/verify-benchmarks.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function clickByText(page: puppeteer.Page, texts: string[], timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const clicked = await page.evaluate((ts) => {
        const all = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"]'));
        const el = all.find((e) => {
          const t = (e.textContent || e.getAttribute('value') || '').trim().toUpperCase();
          return ts.some((s) => t.includes(s.toUpperCase()));
        });
        if (el) {
          (el as HTMLElement).click();
          return true;
        }
        return false;
      }, texts);
      if (clicked) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'bench-test' }),
  }).then((r) => r.json());
  const profileId: string = created?.data?.user_id;
  if (!profileId) throw new Error('profile create failed');

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${profileId}`, { headers }).then((r) =>
    r.json()
  );
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);

  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const page = await browser.newPage();

    // EFF Cover Your Tracks
    console.log('=== EFF Cover Your Tracks ===');
    try {
      await page.goto('https://coveryourtracks.eff.org/', { waitUntil: 'domcontentloaded', timeout: 40000 });
      await new Promise((r) => setTimeout(r, 3000));
      const clicked = await clickByText(page, ['TEST YOUR BROWSER', 'Test your browser']);
      console.log('clicked test button:', clicked);
      await new Promise((r) => setTimeout(r, 25000)); // test runs ~15-20s
      const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      const clean = text.replace(/\s+/g, ' ');
      // The verdict is usually around "fingerprint" / "unique" / "tracking protection"
      const idx = clean.search(/fingerprint/i);
      console.log('FULL (first 2500):', clean.slice(0, 2500));
      if (idx > 0) console.log('VERDICT AREA:', clean.slice(Math.max(0, idx - 300), idx + 900));
    } catch (err) {
      console.log('EFF error:', (err as Error).message);
    }

    // pixelscan
    console.log('\n=== pixelscan ===');
    try {
      await page.goto('https://pixelscan.net/fingerprint-check', { waitUntil: 'domcontentloaded', timeout: 40000 });
      await new Promise((r) => setTimeout(r, 3000));
      const clicked = await clickByText(page, ['Check', 'Start', 'Run', 'Verify']);
      console.log('clicked check button:', clicked);
      await new Promise((r) => setTimeout(r, 22000));
      const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      const clean = text.replace(/\s+/g, ' ');
      const idx = clean.search(/fingerprint is/i);
      console.log('FULL (first 2500):', clean.slice(0, 2500));
      if (idx > 0) console.log('VERDICT AREA:', clean.slice(Math.max(0, idx - 200), idx + 800));
    } catch (err) {
      console.log('pixelscan error:', (err as Error).message);
    }
  } finally {
    browser.disconnect();
    await fetch(`${base}/api/v1/browser/stop?user_id=${profileId}`, { headers });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('BENCHMARK TEST FAILED', err);
  process.exit(1);
});
