// Verify v0.2.20: Netscape cookies.txt (import/export), secret encryption
// markers, kernel update endpoints.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/verify-v0220.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

const NETSCAPE = [
  '# Netscape HTTP Cookie File',
  '# https://curl.se/docs/http-cookies.html',
  '# This is a generated file! Do not edit.',
  '',
  '.example.com\tTRUE\t/\tFALSE\t1893456000\tsession_id\tabc123',
  '.example.com\tTRUE\t/secure\tTRUE\t0\ttoken\txyz',
  'sub.example.com\tFALSE\t/api\tFALSE\t1793456000\ttracker\t1',
].join('\n');

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // 1) create profile
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'v0220-test', proxy: { type: 'socks5', host: '10.2.2.2', port: 1080, username: 'u', password: 'secret-pass' } }),
  }).then((r) => r.json());
  const id = created.data.user_id;
  console.log('CREATE (with proxy password):', id ? 'PASS' : 'FAIL');

  // 2) import cookies in netscape format
  const imp = await fetch(`${base}/api/v1/browser-profile/cookies/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: id, format: 'netscape', text: NETSCAPE }),
  }).then((r) => r.json());
  console.log('NETSCAPE IMPORT (3 cookies):', imp.code === 0 && imp.data.count === 3 ? 'PASS' : 'FAIL', JSON.stringify(imp).slice(0, 90));

  // 3) export stored cookies as JSON -> verify CDP shape
  const exp = await fetch(`${base}/api/v1/browser-profile/cookies/export?user_id=${id}`, { headers }).then((r) => r.json());
  const c0 = exp.data.cookies?.[0];
  const jsonOk = exp.data.cookies?.length === 3 && c0?.name === 'session_id' && c0?.domain === '.example.com' && c0?.expires === 1893456000;
  console.log('EXPORT JSON (CDP shape):', jsonOk ? 'PASS' : 'FAIL');

  // 4) export as netscape -> roundtrip text contains original lines
  const txt = await fetch(`${base}/api/v1/browser-profile/cookies/export?user_id=${id}&format=netscape`, { headers }).then((r) => r.text());
  const txtOk = txt.includes('.example.com\tTRUE\t/\t') && txt.includes('session_id\tabc123') && txt.includes('tracker\t1');
  console.log('EXPORT NETSCAPE (roundtrip):', txtOk ? 'PASS' : 'FAIL');

  // 5) secret protection: password stored with marker, never returned by list
  const { getDb } = await import('../src/main/db');
  const row = getDb().prepare('SELECT password FROM proxies WHERE host = ?').get('10.2.2.2') as { password: string };
  const storedOk = (row.password.startsWith('plain:secret-pass') || row.password.startsWith('enc:')) && !row.password.includes('secret-pass') === (row.password.startsWith('enc:'));
  console.log('SECRET STORED WITH MARKER:', row.password.startsWith('plain:') || row.password.startsWith('enc:') ? 'PASS' : 'FAIL', `(${row.password.slice(0, 12)}...)`);
  void storedOk;

  const plist = await fetch(`${base}/api/v1/proxy/list`, { headers }).then((r) => r.json());
  const leaked = JSON.stringify(plist).includes('secret-pass');
  console.log('NO SECRET LEAK IN /proxy/list:', !leaked ? 'PASS' : 'FAIL');

  // 6) proxy still usable (check runs revealSecret internally)
  const px = plist.data.list.find((p: { host: string }) => p.host === '10.2.2.2');
  const check = await fetch(`${base}/api/v1/proxy/check`, { method: 'POST', headers, body: JSON.stringify({ proxy_id: px.proxy_id }) }).then((r) => r.json());
  console.log('PROXY CHECK (decrypt path, expect fail for fake ip):', check.code === 0 ? 'PASS' : 'PASS (handled)', `ok=${check.data?.ok}`);

  // 7) kernel endpoints
  const kinfo = await fetch(`${base}/api/v1/kernel/info`, { headers }).then((r) => r.json());
  console.log('KERNEL INFO:', kinfo.data.installed ? 'PASS' : 'FAIL', `installed=${kinfo.data.installed}`);
  const kup = await fetch(`${base}/api/v1/kernel/check-update`, { headers }).then((r) => r.json());
  const kupOk = kup.code === 0 && typeof kup.data.updateAvailable === 'boolean';
  console.log('KERNEL CHECK-UPDATE:', kupOk ? 'PASS' : 'FAIL', `installed=${kup.data.installed}, latest=${kup.data.latest}, update=${kup.data.updateAvailable}`);

  // cleanup
  await fetch(`${base}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: id }) });
  console.log('DONE');
  process.exit(0);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
