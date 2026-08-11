// Sprint A verification: geolocation spoofing + cookie injection.
// Creates a profile, imports a cookie, sets geolocation, launches the browser,
// then verifies via CDP that the cookie is present and the geolocation override applies.
// Run: $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50345"; npx tsx scripts/verify-geo-cookies.ts
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
    body: JSON.stringify({ name: 'geo-cookie-test' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  if (!id) throw new Error(`create failed: ${JSON.stringify(created)}`);

  // Import a cookie for example.com
  const cookie = { name: 'test_cookie', value: 'sprint-a', domain: 'example.com', path: '/' };
  const imp = await fetch(`${base}/api/v1/browser-profile/cookies/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: id, cookies: [cookie] }),
  }).then((r) => r.json());
  console.log('cookie import:', JSON.stringify(imp));

  // Set geolocation (Paris)
  const geo = { latitude: 48.8566, longitude: 2.3522 };
  const upd = await fetch(`${base}/api/v1/browser-profile/update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: id, geolocation: geo }),
  }).then((r) => r.json());
  console.log('geo update:', JSON.stringify(upd));

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);

  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    await page.goto('about:blank');
    await page.reload();

    const targets = await browser.targets();
    const pageTarget = targets.find((t) => t.type() === 'page');
    const session = await pageTarget!.createCDPSession();

    // 1) Cookie present via CDP getAllCookies
    const all = (await session.send('Network.getAllCookies')) as {
      cookies: Array<{ name: string; value: string; domain: string }>;
    };
    const found = all.cookies.find((c) => c.name === 'test_cookie');
    console.log('COOKIE:', found ? `PASS (${found.name}=${found.value} @${found.domain})` : 'FAIL (not found)');

    // 2) Geolocation: navigate to a real origin, grant permission for that origin, read coords
    await page.goto('http://example.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => undefined);
    const origin = await page.evaluate(() => location.origin).catch(() => 'http://example.com');
    await session
      .send('Browser.grantPermissions', { origin, permissions: ['geolocation'] })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
    const geoCheck = await page.evaluate(() => {
      return new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve({ supported: false });
          return;
        }
        const t = setTimeout(() => resolve({ timeout: true }), 5000);
        navigator.geolocation.getCurrentPosition(
          (p) => {
            clearTimeout(t);
            resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
          },
          (e) => {
            clearTimeout(t);
            resolve({ error: e.message, code: e.code });
          },
          { timeout: 4500 }
        );
      });
    });
    console.log('GEO:', JSON.stringify(geoCheck));
    await session.detach().catch(() => undefined);
  } finally {
    browser.disconnect();
    await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('GEO/COOKIES TEST FAILED', err);
  process.exit(1);
});
