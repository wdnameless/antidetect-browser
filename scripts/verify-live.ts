// Live verification: content scripts on real sites + fingerprint benchmarks.
// Launches a profile with a test extension, verifies the content script runs on
// real sites, then visits fingerprint benchmarks and captures their verdict text.
// Run: $env:CHROMIUM_PATH="<kernel chrome.exe>"; $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50362"; npx tsx scripts/verify-live.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

const REAL_SITES = ['https://example.com', 'https://www.wikipedia.org', 'https://httpbin.org/html'];

const BENCHMARKS: Array<{ name: string; url: string; waitMs: number }> = [
  { name: 'coveryourtracks (EFF)', url: 'https://coveryourtracks.eff.org/', waitMs: 14000 },
  { name: 'pixelscan', url: 'https://pixelscan.net/fingerprint-check', waitMs: 16000 },
  { name: 'browserscan', url: 'https://www.browserscan.net/', waitMs: 16000 },
  { name: 'browserleaks', url: 'https://browserleaks.com/', waitMs: 10000 },
  { name: 'whoer', url: 'https://whoer.net/', waitMs: 10000 },
  { name: 'creepjs', url: 'https://abrahamjuliot.github.io/creepjs/', waitMs: 16000 },
];

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // Build a minimal MV3 test extension with a content script.
  const extSrc = path.join(os.tmpdir(), 'live-test-ext-' + Date.now());
  fs.mkdirSync(extSrc, { recursive: true });
  fs.writeFileSync(
    path.join(extSrc, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Live Test',
      version: '1.0',
      host_permissions: ['<all_urls>'],
      content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_idle' }],
    })
  );
  fs.writeFileSync(
    path.join(extSrc, 'content.js'),
    "document.documentElement.setAttribute('data-live-ext', 'loaded');"
  );

  const imp = await fetch(`${base}/api/v1/extension/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Live Test', path: extSrc }),
  }).then((r) => r.json());
  const extId: string = imp?.data?.extension_id;
  if (!extId) throw new Error('extension import failed');

  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'live-test' }),
  }).then((r) => r.json());
  const profileId: string = created?.data?.user_id;
  if (!profileId) throw new Error('profile create failed');

  await fetch(`${base}/api/v1/browser-profile/extensions/bind`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: profileId, extension_ids: [extId] }),
  }).then((r) => r.json());

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${profileId}`, { headers }).then((r) =>
    r.json()
  );
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);

  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    await new Promise((r) => setTimeout(r, 2000)); // let the extension initialize
    const page = await browser.newPage();

    // 1) Content script on real sites
    console.log('=== CONTENT SCRIPT ON REAL SITES ===');
    for (const site of REAL_SITES) {
      try {
        await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 1500));
        const marker = await page
          .evaluate(() =>
            (globalThis as unknown as { document: Document }).document.documentElement.getAttribute('data-live-ext')
          )
          .catch(() => null);
        console.log(`  ${site}: ${marker === 'loaded' ? 'PASS (content script ran)' : `FAIL (marker=${String(marker)})`}`);
      } catch (err) {
        console.log(`  ${site}: ERROR ${(err as Error).message}`);
      }
    }

    // 2) Fingerprint benchmarks
    console.log('\n=== FINGERPRINT BENCHMARKS ===');
    for (const b of BENCHMARKS) {
      try {
        await page.goto(b.url, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, b.waitMs));
        const text = await page
          .evaluate(() => (globalThis as unknown as { document: Document }).document.body?.innerText ?? '')
          .catch(() => '');
        const snippet = text.replace(/\s+/g, ' ').slice(0, 700);
        console.log(`\n--- ${b.name} (${b.url}) ---`);
        console.log(snippet || '(empty — likely blocked or still loading)');
      } catch (err) {
        console.log(`\n--- ${b.name} --- ERROR: ${(err as Error).message}`);
      }
    }
  } finally {
    browser.disconnect();
    await fetch(`${base}/api/v1/browser/stop?user_id=${profileId}`, { headers });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('LIVE TEST FAILED', err);
  process.exit(1);
});
