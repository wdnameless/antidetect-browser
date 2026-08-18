// P0-1 verification: stealth layer (Client Hints + headless-trace fixes).
// Run: $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50331"; npx tsx scripts/verify-stealth2.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

interface Signals {
  uaData: string;
  uaDataHighEntropy: string;
  chromeRuntime: boolean;
  chromeWebstore: boolean;
  notificationPermission: string;
  permissionsQuery: string;
  platform: string;
  plugins: number;
  deviceMemory: string;
  maxTouchPoints: number;
  webdriver: boolean;
  hardwareConcurrency: number;
  screenOrientation: string;
  connection: string;
}

async function readSignals(wsEndpoint: string): Promise<Signals> {
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    return await page.evaluate(`(async () => {
      const nav = navigator;
      const uaData = nav.userAgentData;
      let highEntropy = 'n/a';
      if (uaData && uaData.getHighEntropyValues) {
        try {
          const he = await uaData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'wow64', 'formFactors']);
          highEntropy = JSON.stringify(he);
        } catch (e) { highEntropy = 'err:' + e.message; }
      }
      let permQuery = 'n/a';
      try {
        const r = await nav.permissions.query({ name: 'notifications' });
        permQuery = r.state;
      } catch (e) { permQuery = 'err:' + e.message; }
      return {
        uaData: uaData ? JSON.stringify({ brands: uaData.brands, mobile: uaData.mobile, platform: uaData.platform }) : 'null',
        uaDataHighEntropy: highEntropy,
        chromeRuntime: !!(window.chrome && window.chrome.runtime),
        chromeWebstore: !!(window.chrome && window.chrome.webstore),
        notificationPermission: Notification.permission,
        permissionsQuery: permQuery,
        platform: nav.platform,
        plugins: nav.plugins.length,
        deviceMemory: String(nav.deviceMemory),
        maxTouchPoints: nav.maxTouchPoints,
        webdriver: nav.webdriver,
        hardwareConcurrency: nav.hardwareConcurrency,
        screenOrientation: screen.orientation ? screen.orientation.type : 'n/a',
        connection: nav.connection ? nav.connection.effectiveType : 'n/a',
      };
    })()`);
  } finally {
    browser.disconnect();
  }
}

async function launchAndRead(label: string, base: string, headers: Record<string, string>, deviceId?: string): Promise<Signals> {
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: label, device_id: deviceId }),
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
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  const desktop = await launchAndRead('stealth2-desktop', base, headers);
  const android = await launchAndRead('stealth2-android', base, headers, 'dev_android');
  const iphone = await launchAndRead('stealth2-iphone', base, headers, 'dev_iphone');

  console.log('\n=== DESKTOP (no device) ===');
  console.log(JSON.stringify(desktop, null, 2));
  console.log('\n=== ANDROID (Pixel 8) ===');
  console.log(JSON.stringify(android, null, 2));
  console.log('\n=== IPHONE 15 ===');
  console.log(JSON.stringify(iphone, null, 2));

  const checks: Array<[string, boolean]> = [
    ['desktop uaData brands include Google Chrome', JSON.parse(desktop.uaData).brands.some((b: { brand: string }) => b.brand === 'Google Chrome')],
    ['desktop chrome.runtime present', desktop.chromeRuntime],
    ['desktop chrome.webstore present', desktop.chromeWebstore],
    ['desktop Notification.permission != denied', desktop.notificationPermission !== 'denied'],
    ['desktop permissions.query != denied', desktop.permissionsQuery !== 'denied'],
    ['desktop webdriver false', desktop.webdriver === false],
    ['android uaData platform Android', JSON.parse(android.uaData).platform === 'Android'],
    ['android uaData mobile true', JSON.parse(android.uaData).mobile === true],
    ['android high-entropy model Pixel 8', JSON.parse(android.uaDataHighEntropy).model === 'Pixel 8'],
    ['android platform Linux armv8l', android.platform === 'Linux armv8l'],
    ['android plugins empty', android.plugins === 0],
    ['android deviceMemory undefined', android.deviceMemory === 'undefined'],
    ['android maxTouchPoints 5', android.maxTouchPoints === 5],
    ['android screen orientation portrait', android.screenOrientation === 'portrait-primary'],
    ['android connection 4g', android.connection === '4g'],
    ['android chrome.runtime present', android.chromeRuntime],
    ['android Notification.permission != denied', android.notificationPermission !== 'denied'],
    ['iphone uaData platform iOS', JSON.parse(iphone.uaData).platform === 'iOS'],
    ['iphone platform iPhone', iphone.platform === 'iPhone'],
    ['iphone plugins empty', iphone.plugins === 0],
    ['iphone maxTouchPoints 5', iphone.maxTouchPoints === 5],
  ];

  let failed = 0;
  console.log('\n=== CHECKS ===');
  for (const [name, ok] of checks) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? '\nSTEALTH2 OK' : `\nSTEALTH2 FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 2);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
