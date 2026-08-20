// Probe creepjs likeHeadless signals on our browser.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-likeheadless.ts
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
    body: JSON.stringify({ name: 'probe-likeheadless' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });

    const res = await page.evaluate(async () => {
      const out: Record<string, unknown> = {};
      out.hasContentIndex = 'ContentIndex' in window;
      out.hasContactsManager = 'ContactsManager' in window;
      out.hasDownlinkMax = 'downlinkMax' in (window.NetworkInformation?.prototype || {});
      out.pdfViewerEnabled = navigator.pdfViewerEnabled;
      out.hasShare = 'share' in navigator;
      out.hasCanShare = 'canShare' in navigator;
      out.prefersLight = matchMedia('(prefers-color-scheme: light)').matches;
      out.prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
      // ActiveText bg color (headless renders red)
      const d = document.createElement('div');
      document.body.appendChild(d);
      d.setAttribute('style', 'background-color: ActiveText');
      out.activeTextBg = getComputedStyle(d).backgroundColor;
      document.body.removeChild(d);
      out.v84 = CSS.supports('appearance: initial');
      out.v80 = CSS.supports('color-scheme: initial');
      out.v89 = CSS.supports('border-end-end-radius: initial');
      out.hasBarcodeDetector = 'BarcodeDetector' in window;
      out.hasEyeDropper = 'EyeDropper' in window;
      out.hasFileSystemWritable = 'FileSystemWritableFileStream' in window;
      out.hasHid = 'HID' in window;
      out.hasSerialPort = 'SerialPort' in window;
      out.hasSharedWorker = 'SharedWorker' in window;
      out.hasAppBadge = 'setAppBadge' in Navigator.prototype;
      out.hasTouch = 'ontouchstart' in window && 'TouchEvent' in window;
      return out;
    });
    console.log(JSON.stringify(res, null, 2));
  } finally {
    browser.disconnect();
  }
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  process.exit(0);
}

main().catch((err) => {
  console.error('PROBE FAILED', err);
  process.exit(1);
});
