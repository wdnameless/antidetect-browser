// Phase 2 stealth verification: launch profiles on the fingerprint-chromium kernel,
// verify navigator.webdriver === false and per-profile fingerprint uniqueness.
// Run: $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50331"; npx tsx scripts/verify-stealth.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT, getChromiumPath } from '../src/main/config';

interface Signals {
  webdriver: boolean | undefined;
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number | undefined;
  language: string;
  canvasHash: string;
}

async function readSignals(wsEndpoint: string): Promise<Signals> {
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    await page.goto('about:blank');
    return await page.evaluate(() => {
      let canvasHash = 'n/a';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(2, 2, 120, 24);
        ctx.fillStyle = '#069';
        ctx.fillText('antidetect-fp-test!', 4, 17);
        const s = canvas.toDataURL();
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        canvasHash = String(h);
      }
      const nav = navigator as Navigator & { webdriver?: boolean; deviceMemory?: number };
      return {
        webdriver: nav.webdriver,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: nav.deviceMemory,
        language: navigator.language,
        canvasHash,
      };
    });
  } finally {
    browser.disconnect();
  }
}

async function launchAndRead(label: string, base: string, headers: Record<string, string>): Promise<Signals> {
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: label }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  if (!id) throw new Error(`create failed for ${label}: ${JSON.stringify(created)}`);

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (started?.code !== 0) throw new Error(`start failed for ${label}: ${started?.msg}`);

  const signals = await readSignals(started.data.ws.puppeteer);
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  return signals;
}

async function main(): Promise<void> {
  console.log('Kernel executable:', getChromiumPath());
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  const a = await launchAndRead('stealth-A', base, headers);
  const b = await launchAndRead('stealth-B', base, headers);

  console.log('\nProfile A:', JSON.stringify(a, null, 2));
  console.log('\nProfile B:', JSON.stringify(b, null, 2));

  const webdriverOk = a.webdriver === false && b.webdriver === false;
  const uniqueCanvas = a.canvasHash !== b.canvasHash;

  console.log('\n=== VERDICT ===');
  console.log(
    'webdriver === false (A and B):',
    webdriverOk ? 'PASS' : 'FAIL',
    `(A=${String(a.webdriver)}, B=${String(b.webdriver)})`
  );
  console.log(
    'canvas fingerprint unique per profile:',
    uniqueCanvas ? 'PASS' : 'FAIL',
    `(A=${a.canvasHash}, B=${b.canvasHash})`
  );

  if (webdriverOk && uniqueCanvas) {
    console.log('\nSTEALTH OK');
    process.exit(0);
  } else {
    console.log('\nSTEALTH CHECK INCOMPLETE');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
