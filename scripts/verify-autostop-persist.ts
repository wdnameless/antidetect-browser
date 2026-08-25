// Verify v0.2.24:
//  1) WATCHDOG: start a profile, kill the browser process externally (simulates
//     the user closing the window) -> profile must become "closed" automatically.
//  2) PERSISTENCE: cookies/sessions survive profile restarts (user-data-dir).
//  3) SCREEN OVERRIDE: fingerprint config screen -> window-size flag applied.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50341"; npx tsx scripts/verify-autostop-persist.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';
import { execFile } from 'child_process';
import puppeteer from 'puppeteer-core';

const base = `http://${API_HOST}:${API_PORT}`;

function killTree(pid: number): void {
  execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
}

async function main(): Promise<void> {
  await startService();
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };
  let pass = 0;
  let fail = 0;
  const ok = (name: string, v: boolean): void => {
    console.log(`${name}: ${v ? 'PASS' : 'FAIL'}`);
    v ? pass++ : fail++;
  };

  // ---- 1) WATCHDOG ----
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'watchdog-test' }),
  }).then((r) => r.json());
  const id = created.data.user_id;
  const start = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (start.code !== 0) throw new Error('start failed: ' + start.msg);
  const browserPid: number = start.data.pid;

  const list1 = await fetch(`${base}/api/v1/browser/list?search=watchdog-test`, { headers }).then((r) => r.json());
  ok('RUNNING BEFORE CLOSE', list1.data.list[0]?.status === 'running');

  // simulate the user closing the browser window
  killTree(browserPid);
  let closedSeen = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const l = await fetch(`${base}/api/v1/browser/list?search=watchdog-test`, { headers }).then((r) => r.json());
    if (l.data.list[0]?.status === 'closed') { closedSeen = true; break; }
  }
  ok('WATCHDOG AUTO-STOP ON BROWSER CLOSE (<10s)', closedSeen);

  // ---- 2) PERSISTENCE (cookies/sessions across restarts) ----
  // start, inject a cookie via CDP on example.com, stop, start again, read back
  const s1 = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (s1.code !== 0) throw new Error('restart 1 failed: ' + s1.msg);
  const browser = await puppeteer.connect({ browserWSEndpoint: s1.data.ws.puppeteer, defaultViewport: null });
  const page = await browser.newPage();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
  await page.evaluate(() => {
    document.cookie = 'persist_test=hello_session_42; path=/; max-age=31536000';
  });
  browser.disconnect();
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  await new Promise((r) => setTimeout(r, 1500));

  const s2 = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (s2.code !== 0) throw new Error('restart 2 failed: ' + s2.msg);
  const b2 = await puppeteer.connect({ browserWSEndpoint: s2.data.ws.puppeteer, defaultViewport: null });
  const p2 = await b2.newPage();
  await p2.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
  const cookieVal = await p2.evaluate(() =>
    document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('persist_test='))
  );
  b2.disconnect();
  ok('COOKIE PERSISTS ACROSS RESTART', cookieVal === 'persist_test=hello_session_42');
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });

  // ---- 3) SCREEN OVERRIDE ----
  await fetch(`${base}/api/v1/browser-profile/fingerprint`, {
    method: 'POST', headers,
    body: JSON.stringify({ user_id: id, config: { screen: { width: 1600, height: 900 } } }),
  });
  const s3 = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (s3.code !== 0) throw new Error('restart 3 failed: ' + s3.msg);
  await new Promise((r) => setTimeout(r, 2500));
  const b3 = await puppeteer.connect({ browserWSEndpoint: s3.data.ws.puppeteer, defaultViewport: null });
  const p3 = (await b3.pages())[0] ?? (await b3.newPage());
  const dims = await p3.evaluate(() => ({ w: window.screen.width, h: window.screen.height, iw: window.innerWidth }));
  b3.disconnect();
  await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  ok('SCREEN OVERRIDE 1600x900 APPLIED', dims.w === 1600 || dims.iw === 1600, JSON.stringify(dims));

  // cleanup
  await fetch(`${base}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: id }) });
  console.log(`\nRESULT: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('VERIFY FAILED', err); process.exit(1); });
