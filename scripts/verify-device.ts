// Phase 4 device switching verification:
//  - macOS preset -> navigator.platform/userAgent show macOS
//  - iPhone preset -> mobile UA, touch, screen metrics
// Run: $env:API_PORT="50333"; npx tsx scripts/verify-device.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

interface DeviceSignals {
  platform: string;
  userAgent: string;
  hardwareConcurrency: number;
  maxTouchPoints: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  touchSupported: boolean;
}

async function readSignals(wsEndpoint: string): Promise<DeviceSignals> {
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    await page.goto('about:blank');
    // Emulation (touch metrics) applies to freshly loaded documents — reload to pick it up.
    await page.reload();
    return await page.evaluate(() => ({
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      maxTouchPoints: navigator.maxTouchPoints,
      screenWidth: screen.width,
      screenHeight: screen.height,
      devicePixelRatio: window.devicePixelRatio,
      touchSupported: 'ontouchstart' in window,
    }));
  } finally {
    browser.disconnect();
  }
}

async function launchWithDevice(
  label: string,
  deviceId: string,
  base: string,
  headers: Record<string, string>
): Promise<DeviceSignals> {
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: label }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  if (!id) throw new Error(`create failed: ${JSON.stringify(created)}`);

  const bind = await fetch(`${base}/api/v1/browser-profile/update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: id, device_id: deviceId }),
  }).then((r) => r.json());
  if (bind?.code !== 0) throw new Error(`bind failed: ${bind?.msg}`);

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);

  const signals = await readSignals(started.data.ws.puppeteer);
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  return signals;
}

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  const mac = await launchWithDevice('device-mac', 'dev_macos', base, headers);
  const iphone = await launchWithDevice('device-iphone', 'dev_iphone', base, headers);

  console.log('\nmacOS preset:', JSON.stringify(mac, null, 2));
  console.log('\niPhone preset:', JSON.stringify(iphone, null, 2));

  const macOk = mac.platform === 'MacIntel' && /Macintosh/.test(mac.userAgent);
  const iphoneOk =
    /iPhone/.test(iphone.userAgent) &&
    iphone.maxTouchPoints > 0 &&
    iphone.touchSupported &&
    iphone.screenWidth === 393 &&
    iphone.devicePixelRatio === 3;

  console.log('\n=== VERDICT ===');
  console.log(
    'macOS preset (platform/UA):',
    macOk ? 'PASS' : 'FAIL',
    `(platform=${mac.platform}, cores=${mac.hardwareConcurrency})`
  );
  console.log(
    'iPhone preset (UA/touch/screen):',
    iphoneOk ? 'PASS' : 'FAIL',
    `(UA=${iphone.userAgent.slice(0, 55)}..., touch=${iphone.touchSupported}, ${iphone.screenWidth}x${iphone.screenHeight}@${iphone.devicePixelRatio}x, maxTouchPoints=${iphone.maxTouchPoints})`
  );

  if (macOk && iphoneOk) {
    console.log('\nDEVICE PHASE OK');
    process.exit(0);
  } else {
    console.log('\nDEVICE PHASE INCOMPLETE');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('DEVICE TEST FAILED', err);
  process.exit(1);
});
