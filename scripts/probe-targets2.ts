// Experiment: does emulation/injection survive navigation from chrome://newtab to a real page?
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/probe-targets2.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';
import { buildStealthScript } from '../src/main/proxy/stealthInjection';

async function readSignals(page: puppeteer.Page) {
  return page.evaluate(() => ({
    ua: navigator.userAgent.slice(0, 60),
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    screenW: screen.width,
    dpr: window.devicePixelRatio,
    runtime: !!window.chrome?.runtime,
    webstore: !!window.chrome?.webstore,
    uaDataMobile: navigator.userAgentData ? navigator.userAgentData.mobile : null,
    uaDataPlatform: navigator.userAgentData ? navigator.userAgentData.platform : null,
  }));
}

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'probe-targets2', device_id: 'dev_android' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0];
    console.log('initial page url:', page.url());

    // Scenario A: navigate directly to example.com (no prior about:blank)
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log('A) after direct nav to example.com:', JSON.stringify(await readSignals(page)));

    // Scenario B: now apply stealth via Runtime.evaluate on the CURRENT document
    await page.evaluate(buildStealthScript({ mobile: true, logicalPlatform: 'android', model: 'Pixel 8' }));
    console.log('B) after Runtime.evaluate on current doc:', JSON.stringify(await readSignals(page)));

    // Scenario C: reload — does addScriptToEvaluateOnNewDocument-style state survive? (we used evaluate, so no)
    // Instead: register via CDP session now, then navigate to a second page
    const session = await page.createCDPSession();
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildStealthScript({ mobile: true, logicalPlatform: 'android', model: 'Pixel 8' }),
    });
    await page.goto('https://example.org/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log('C) after CDP-registered script + nav to example.org:', JSON.stringify(await readSignals(page)));

    // Scenario D: about:blank first, then real page (verify-device pattern)
    await page.goto('about:blank');
    await page.reload();
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log('D) about:blank -> reload -> example.com:', JSON.stringify(await readSignals(page)));
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
