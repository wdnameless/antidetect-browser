// Benchmark run 2: EFF Cover Your Tracks verdict + BrowserLeaks sub-tests.
// Run: $env:CHROMIUM_PATH="<kernel chrome.exe>"; $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50371"; npx tsx scripts/verify-benchmarks2.ts
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
    body: JSON.stringify({ name: 'bench2' }),
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
      await clickByText(page, ['TEST YOUR BROWSER', 'Test your browser']);
      await new Promise((r) => setTimeout(r, 30000)); // test takes ~20-30s
      const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      const clean = text.replace(/\s+/g, ' ');
      // Verdict is around "unique" / "bits of identifying information"
      const uniqueIdx = clean.search(/unique/i);
      const bitsIdx = clean.search(/bits of identifying/i);
      console.log('UNIQUE AREA:', uniqueIdx >= 0 ? clean.slice(Math.max(0, uniqueIdx - 200), uniqueIdx + 400) : '(not found)');
      console.log('BITS AREA:', bitsIdx >= 0 ? clean.slice(Math.max(0, bitsIdx - 200), bitsIdx + 400) : '(not found)');
      console.log('SNIPPET:', clean.slice(0, 1500));
    } catch (err) {
      console.log('EFF error:', (err as Error).message);
    }

    // BrowserLeaks sub-tests
    const blTests: Array<{ name: string; url: string; waitMs: number }> = [
      { name: 'canvas', url: 'https://browserleaks.com/canvas', waitMs: 6000 },
      { name: 'webgl', url: 'https://browserleaks.com/webgl', waitMs: 6000 },
      { name: 'fonts', url: 'https://browserleaks.com/fonts', waitMs: 8000 },
      { name: 'webrtc', url: 'https://browserleaks.com/webrtc', waitMs: 8000 },
      { name: 'tls', url: 'https://browserleaks.com/tls', waitMs: 6000 },
    ];
    for (const t of blTests) {
      console.log(`\n=== BrowserLeaks ${t.name} ===`);
      try {
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
        await new Promise((r) => setTimeout(r, t.waitMs));
        const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        const clean = text.replace(/\s+/g, ' ');
        // Find the result table area
        const idx = clean.search(/result|fingerprint|hash|detected|leak/i);
        console.log(clean.slice(Math.max(0, (idx > 0 ? idx - 100 : 0)), (idx > 0 ? idx : 0) + 900));
      } catch (err) {
        console.log(`${t.name} error:`, (err as Error).message);
      }
    }
  } finally {
    browser.disconnect();
    await fetch(`${base}/api/v1/browser/stop?user_id=${profileId}`, { headers });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('BENCH2 FAILED', err);
  process.exit(1);
});
