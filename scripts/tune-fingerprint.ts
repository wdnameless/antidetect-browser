// Tier 2 empirical tuning: run pixelscan with different fingerprint configs
// and capture the "Fingerprint is ..." verdict to find the inconsistency source.
// Run: $env:CHROMIUM_PATH="<kernel chrome.exe>"; $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50365"; npx tsx scripts/tune-fingerprint.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

const CONFIGS: Array<{ label: string; config: Record<string, unknown> }> = [
  { label: 'default', config: {} },
  { label: 'canvas-off', config: { disableSpoofing: 'canvas' } },
  { label: 'audio-off', config: { disableSpoofing: 'audio' } },
  { label: 'canvas-audio-off', config: { disableSpoofing: 'audio,canvas' } },
];

async function runPixelscan(
  base: string,
  headers: Record<string, string>,
  label: string,
  config: Record<string, unknown>
): Promise<string> {
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: `tune-${label}` }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  if (!id) throw new Error('create failed');

  if (Object.keys(config).length) {
    await fetch(`${base}/api/v1/browser-profile/fingerprint`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: id, config }),
    }).then((r) => r.json());
  }

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);

  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  let verdict = '';
  try {
    const page = await browser.newPage();
    await page.goto('https://pixelscan.net/fingerprint-check', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await new Promise((r) => setTimeout(r, 3000));
    // click the check button
    await page
      .evaluate(() => {
        const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const el = all.find((e) => /check|start|run|verify/i.test((e.textContent || '').trim()));
        if (el) (el as HTMLElement).click();
      })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20000));
    const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    const clean = text.replace(/\s+/g, ' ');
    const m = clean.match(/Fingerprint is\s+([^.]{0,60})/i);
    verdict = m ? m[1].trim() : '(verdict not found)';
    // Print key fingerprint fields for every config to compare.
    const fields = [
      'Timezone from JS',
      'WebGL Vendor',
      'WebGL Renderer',
      'WebGL Hash',
      'Canvas Hash',
      'AudioContext Hash',
      'Fonts ',
      'HardwareConcurency',
      'Screen Resolution',
      'Platform ',
    ];
    const detail: string[] = [];
    for (const f of fields) {
      const idx = clean.indexOf(f);
      if (idx >= 0) detail.push(clean.slice(idx, idx + 90).trim());
    }
    console.log(`[${label}] ${detail.join(' | ')}`);
  } finally {
    browser.disconnect();
    await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  }
  return verdict;
}

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  for (const c of CONFIGS) {
    try {
      const verdict = await runPixelscan(base, headers, c.label, c.config);
      console.log(`${c.label.padEnd(28)} -> ${verdict}`);
    } catch (err) {
      console.log(`${c.label.padEnd(28)} -> ERROR ${(err as Error).message}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('TUNE FAILED', err);
  process.exit(1);
});
