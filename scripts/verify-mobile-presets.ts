// Verify "Мобильный профиль v2" (Этап 2): deterministic mobile presets by seed.
// - different seeds -> different phone models
// - same seed across restarts -> same model (one profile = one "phone")
// - UA contains the model string
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/verify-mobile-presets.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';
import { pickMobilePreset, buildMobileUa, MOBILE_PRESETS } from '../src/main/devices/mobilePresets';

async function readUa(wsEndpoint: string): Promise<string> {
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    return await page.evaluate(() => navigator.userAgent);
  } finally {
    browser.disconnect();
  }
}

async function launchAndReadUa(label: string, base: string, headers: Record<string, string>, seed?: number): Promise<string> {
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: label, device_id: 'dev_android', fingerprint_seed: seed }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);
  const ua = await readUa(started.data.ws.puppeteer);
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  return ua;
}

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // 1) Pool sanity: 30+ presets, unique ids.
  console.log('pool size:', MOBILE_PRESETS.length);
  const uniqueIds = new Set(MOBILE_PRESETS.map((p) => p.id));
  console.log('POOL (>=30, unique ids):', MOBILE_PRESETS.length >= 30 && uniqueIds.size === MOBILE_PRESETS.length ? 'PASS' : 'FAIL');

  // 2) Determinism: same seed -> same preset; different seeds -> different presets (mostly).
  const a = pickMobilePreset(123456789);
  const b = pickMobilePreset(123456789);
  const c = pickMobilePreset(987654321);
  console.log('seed 123456789 ->', a.name, '| again ->', b.name, '| seed 987654321 ->', c.name);
  console.log('DETERMINISTIC (same seed):', a.id === b.id ? 'PASS' : 'FAIL');
  console.log('DIVERSE (different seeds):', a.id !== c.id ? 'PASS' : 'FAIL');

  // 3) UA builder contains model.
  const ua = buildMobileUa(a);
  console.log('UA:', ua.slice(0, 80));
  console.log('UA CONTAINS MODEL:', ua.includes(a.model) ? 'PASS' : 'FAIL');

  // 4) Live: two profiles with EXPLICIT different seeds -> different models in UA;
  //    the SAME profile restarted -> same model (deterministic per profile).
  const ua1 = await launchAndReadUa('mobile-preset-1', base, headers, 111111);
  const ua2 = await launchAndReadUa('mobile-preset-2', base, headers, 222222);

  // Same profile, two starts:
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'mobile-preset-restart', device_id: 'dev_android' }),
  }).then((r) => r.json());
  const rid: string = created?.data?.user_id;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await sleep(300);
  const start1 = await fetch(`${base}/api/v1/browser/start?user_id=${rid}`, { headers }).then((r) => r.json());
  if (start1?.code !== 0) throw new Error('restart start1 failed: ' + start1?.msg);
  const ua1b = await readUa(start1.data.ws.puppeteer);
  await fetch(`${base}/api/v1/browser/stop?user_id=${rid}`, { headers });
  // Wait for the process to fully exit before starting again (stop is async).
  await sleep(1500);
  const start2 = await fetch(`${base}/api/v1/browser/start?user_id=${rid}`, { headers }).then((r) => r.json());
  if (start2?.code !== 0) throw new Error('restart start2 failed: ' + start2?.msg);
  const ua1c = await readUa(start2.data.ws.puppeteer);
  await fetch(`${base}/api/v1/browser/stop?user_id=${rid}`, { headers });

  console.log('live UA1:', ua1.slice(0, 70));
  console.log('live UA2:', ua2.slice(0, 70));
  console.log('restart UA (1st start):', ua1b.slice(0, 70));
  console.log('restart UA (2nd start):', ua1c.slice(0, 70));
  console.log('LIVE DIFFERENT MODELS:', ua1 !== ua2 ? 'PASS' : 'FAIL');
  console.log('LIVE SAME MODEL ON RESTART:', ua1b === ua1c ? 'PASS' : 'FAIL');

  // 5) Fixed model: create with explicit mobile_model_id -> UA must contain that model,
  //    regardless of seed.
  const fixed = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'mobile-fixed', device_id: 'dev_android', fingerprint_seed: 111111, mobile_model_id: 'pixel_9' }),
  }).then((r) => r.json());
  const fid: string = fixed?.data?.user_id;
  const fstart = await fetch(`${base}/api/v1/browser/start?user_id=${fid}`, { headers }).then((r) => r.json());
  if (fstart?.code !== 0) throw new Error('fixed start failed: ' + fstart?.msg);
  const fua = await readUa(fstart.data.ws.puppeteer);
  await fetch(`${base}/api/v1/browser/stop?user_id=${fid}`, { headers });
  console.log('fixed model UA:', fua.slice(0, 70));
  console.log('FIXED MODEL (pixel_9):', fua.includes('Pixel 9') ? 'PASS' : 'FAIL');

  // 6) Manual seed: same seed + no model -> same phone across two profiles.
  const s1 = await launchAndReadUa('mobile-seed-a', base, headers, 555555);
  const s2 = await launchAndReadUa('mobile-seed-b', base, headers, 555555);
  console.log('seed 555555 UA1:', s1.slice(0, 70));
  console.log('seed 555555 UA2:', s2.slice(0, 70));
  console.log('MANUAL SEED (same phone):', s1 === s2 ? 'PASS' : 'FAIL');

  process.exit(0);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
