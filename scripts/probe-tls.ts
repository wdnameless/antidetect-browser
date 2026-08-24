// TLS-fingerprint pilot (ADR research): measures JA3/JA4 on both kernels —
// fingerprint-chromium (Chromium stack) vs Camoufox (Firefox stack) — via
// tls.peet.ws. Read-only research probe; no app changes.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-tls.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';
import puppeteer from 'puppeteer-core';
import { getRunningPage } from '../src/main/launcher/firefox';

const TLS_URL = 'https://tls.peet.ws/api/all';

interface PeetResult {
  ja3?: string;
  ja3_hash?: string;
  ja4?: string;
  user_agent?: string;
  tls?: { ja4?: string };
}

async function probeChromium(base: string, headers: Record<string, string>): Promise<void> {
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'tls-probe-chromium' }),
  }).then((r) => r.json());
  const id = created.data.user_id;
  const start = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (start.code !== 0) throw new Error('chromium start failed: ' + start.msg);

  try {
    const browser = await puppeteer.connect({ browserWSEndpoint: start.data.ws.puppeteer, defaultViewport: null });
    const page = await browser.newPage();
    await page.goto(TLS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const text = await page.evaluate(() => document.body.innerText);
    const data = JSON.parse(text) as PeetResult;
    console.log('=== fingerprint-chromium (Chromium stack) ===');
    console.log('JA3 hash:', data.ja3_hash);
    console.log('JA4:', data.tls?.ja4 ?? data.ja4);
    console.log('UA:', (data.user_agent ?? '').slice(0, 80));
    browser.disconnect();
  } finally {
    await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
    await fetch(`${base}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: id }) });
  }
}

async function probeCamoufox(base: string, headers: Record<string, string>): Promise<void> {
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'tls-probe-firefox', browser_type: 'firefox' }),
  }).then((r) => r.json());
  const id = created.data.user_id;
  const start = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (start.code !== 0) {
    console.log('=== Camoufox (Firefox stack) ===');
    console.log('SKIPPED:', start.msg);
    await fetch(`${base}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: id }) });
    return;
  }
  try {
    // Managed model: the launcher holds the playwright Page for this profile.
    const page = getRunningPage(id);
    if (!page) throw new Error('no managed page for the firefox profile');
    await page.goto(TLS_URL, { timeout: 30000 });
    const text = await page.evaluate(() => document.body.innerText);
    const data = JSON.parse(text) as PeetResult;
    console.log('=== Camoufox (Firefox stack) ===');
    console.log('JA3 hash:', data.ja3_hash);
    console.log('JA4:', data.tls?.ja4 ?? data.ja4);
    console.log('UA:', (data.user_agent ?? '').slice(0, 80));
  } finally {
    await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
    await fetch(`${base}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: id }) });
  }
}

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  await probeChromium(base, headers);
  await probeCamoufox(base, headers);
  console.log('TLS PROBE DONE (compare JA4 values: identical = kernel stack does not differentiate TLS)');
  process.exit(0);
}

main().catch((err) => {
  console.error('TLS PROBE FAILED', err);
  process.exit(1);
});
