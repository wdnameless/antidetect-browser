// Check stealth extension state directly on creepjs page + dump creepjs headless signals.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-creepjs.ts
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
    body: JSON.stringify({ name: 'probe-creepjs' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    await page.goto('https://abrahamjuliot.github.io/creepjs/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));

    const res = await page.evaluate(() => {
      const chrome = window.chrome || {};
      return {
        chromeKeys: Object.keys(chrome),
        runtime: !!chrome.runtime,
        runtimeId: chrome.runtime?.id,
        runtimeManifest: chrome.runtime ? JSON.stringify(chrome.runtime.getManifest()) : null,
        csi: typeof chrome.csi,
        loadTimes: typeof chrome.loadTimes,
        app: !!chrome.app,
        webstore: !!chrome.webstore,
        uaData: navigator.userAgentData ? JSON.stringify(navigator.userAgentData) : null,
        webdriver: navigator.webdriver,
        notification: Notification.permission,
        plugins: navigator.plugins.length,
        languages: navigator.languages.length,
        deviceMemory: navigator.deviceMemory,
        hardwareConcurrency: navigator.hardwareConcurrency,
        maxTouchPoints: navigator.maxTouchPoints,
        orientation: screen.orientation?.type,
        outerW: window.outerWidth,
        innerW: window.innerWidth,
        outerH: window.outerHeight,
        innerH: window.innerHeight,
        visibility: document.visibilityState,
        hasCdc: !!window.cdc_,
        domAutomation: !!window.domAutomation,
        domAutomationController: !!window.domAutomationController,
      };
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
