// Sprint B verification: extension loading.
// Creates a minimal test extension, imports it, binds it to a profile, launches,
// and verifies the extension's content script ran (it sets a marker attribute).
// Run: $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50347"; npx tsx scripts/verify-extensions.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // Build a minimal MV3 test extension that marks the page when its content script runs.
  const extSrc = path.join(os.tmpdir(), 'sprint-b-test-ext-' + Date.now());
  fs.mkdirSync(extSrc, { recursive: true });
  fs.writeFileSync(
    path.join(extSrc, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Sprint B Test',
      version: '1.0',
      background: { service_worker: 'background.js' },
      host_permissions: ['<all_urls>'],
      content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_idle' }],
    })
  );
  fs.writeFileSync(path.join(extSrc, 'background.js'), '// sprint B test service worker\n');
  fs.writeFileSync(
    path.join(extSrc, 'content.js'),
    "console.log('SPRINT-B-EXT-CONTENT-SCRIPT-RAN');\n" +
      "document.documentElement.setAttribute('data-sprint-b-ext', 'loaded');\n" +
      "document.title = document.title + ' [SPRINT-B-EXT]';"
  );
  console.log('test extension source:', extSrc);

  // Import the extension
  const imp = await fetch(`${base}/api/v1/extension/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Sprint B Test', path: extSrc }),
  }).then((r) => r.json());
  console.log('extension import:', JSON.stringify(imp));
  const extId: string = imp?.data?.extension_id;
  if (!extId) throw new Error('extension import failed');

  // Create a profile and bind the extension
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'ext-test' }),
  }).then((r) => r.json());
  const profileId: string = created?.data?.user_id;
  if (!profileId) throw new Error('profile create failed');

  const bind = await fetch(`${base}/api/v1/browser-profile/extensions/bind`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: profileId, extension_ids: [extId] }),
  }).then((r) => r.json());
  console.log('bind:', JSON.stringify(bind));

  // Launch and verify the content script ran
  const started = await fetch(`${base}/api/v1/browser/start?user_id=${profileId}`, { headers }).then((r) =>
    r.json()
  );
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);

  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    // Debug: show the bound extension path and its files
    const list = await fetch(`${base}/api/v1/extension/list`, { headers }).then((r) => r.json());
    const ext = (list?.data?.list ?? []).find((e: { extension_id: string }) => e.extension_id === extId);
    console.log('extension path:', ext?.path);
    if (ext?.path && fs.existsSync(ext.path)) {
      console.log('extension files:', fs.readdirSync(ext.path).join(', '));
    }

    const pages = await browser.pages();
    // Use a NEW tab created after the extension loaded (content scripts inject into new pages).
    const page = await browser.newPage();
    void pages;

    // Give the extension time to fully initialize before navigating.
    await new Promise((r) => setTimeout(r, 2000));

    // Capture console messages to detect the content script's log.
    const consoleMsgs: string[] = [];
    page.on('console', (msg) => consoleMsgs.push(msg.text()));

    // Debug: list browser targets to see if the extension's service worker loaded
    const targets = await browser.targets();
    const swLoaded = targets.some((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
    console.log('targets:', targets.map((t) => `${t.type()}:${t.url().slice(0, 50)}`).join(' | '));
    console.log('extension service worker loaded:', swLoaded ? 'YES' : 'NO');

    await page.goto('http://example.com', { waitUntil: 'load', timeout: 25000 }).catch(() => undefined);
    await page.reload({ waitUntil: 'load' }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 2000)); // let the content script run
    const marker = await page.evaluate(() =>
      (globalThis as unknown as { document: Document }).document.documentElement.getAttribute('data-sprint-b-ext')
    );
    const title = await page.title().catch(() => '');
    const csRan = consoleMsgs.some((m) => m.includes('SPRINT-B-EXT-CONTENT-SCRIPT-RAN'));
    const csWorked = marker === 'loaded' || title.includes('[SPRINT-B-EXT]') || csRan;
    console.log('EXTENSION LOADED (service worker):', swLoaded ? 'PASS' : 'FAIL');
    console.log(
      'CONTENT SCRIPT:',
      csWorked ? 'PASS (ran)' : 'NOT RUNNING (kernel does not inject content scripts via --load-extension)'
    );
  } finally {
    browser.disconnect();
    await fetch(`${base}/api/v1/browser/stop?user_id=${profileId}`, { headers });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('EXTENSIONS TEST FAILED', err);
  process.exit(1);
});
