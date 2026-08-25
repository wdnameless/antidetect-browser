// Verify v0.2.26: proxy list import (Webshare format), geo check flow,
// backups list/restore.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50341"; npx tsx scripts/verify-v0226.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

const SAMPLE = [
  '# comment line',
  '145.223.59.161:6195:zpmigfas:xcn562htzyka',
  '195.40.122.162:6846:zpmigfas:xcn562htzyka',
  'socks5://u1:p1@82.23.229.141:7498',
  'u2:p2@104.238.7.117:6044',
  '23.27.127.207:7172',
  'not a proxy line',
  '145.223.59.161:6195:zpmigfas:xcn562htzyka', // duplicate within list
].join('\n');

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };
  let pass = 0, fail = 0;
  const ok = (n: string, v: boolean, extra = ''): void => {
    console.log(`${n}: ${v ? 'PASS' : 'FAIL'}${extra ? ' (' + extra + ')' : ''}`);
    v ? pass++ : fail++;
  };

  // 1) import-list
  const imp = await fetch(`${base}/api/v1/proxy/import-list`, {
    method: 'POST', headers,
    body: JSON.stringify({ text: SAMPLE, defaultProtocol: 'socks5' }),
  }).then((r) => r.json());
  ok('IMPORT-LIST created=5', imp.data?.created === 5, JSON.stringify({ c: imp.data?.created, d: imp.data?.duplicates, i: imp.data?.invalid }));
  ok('IMPORT-LIST duplicates=1', imp.data?.duplicates === 1);
  ok('IMPORT-LIST invalid=1', imp.data?.invalid === 1);

  // 2) verify stored rows: types + credentials
  const list = await fetch(`${base}/api/v1/proxy/list`, { headers }).then((r) => r.json());
  const byHost = (h: string) => list.data.list.find((p: { host: string }) => p.host === h);
  const webshare = byHost('145.223.59.161');
  ok('WEBSHARE LINE (socks5 default + creds)', webshare?.type === 'socks5' && webshare?.username === 'zpmigfas');
  const prefixed = byHost('82.23.229.141');
  ok('PREFIXED LINE (socks5://u1:p1@)', prefixed?.type === 'socks5' && prefixed?.username === 'u1');
  const atFmt = byHost('104.238.7.117');
  ok('AT-FORMAT LINE (user:pass@)', atFmt?.type === 'socks5' && atFmt?.username === 'u2');
  const bare = byHost('23.27.127.207');
  ok('BARE host:port (default proto)', bare?.type === 'socks5' && !bare?.username);

  // 3) re-import -> all duplicates
  const imp2 = await fetch(`${base}/api/v1/proxy/import-list`, {
    method: 'POST', headers,
    body: JSON.stringify({ text: SAMPLE, defaultProtocol: 'socks5' }),
  }).then((r) => r.json());
  ok('RE-IMPORT deduped (created=0, dup=6)', imp2.data?.created === 0 && imp2.data?.duplicates === 6, JSON.stringify({ c: imp2.data?.created, d: imp2.data?.duplicates }));

  // 4) geo check on one proxy (real network call; fake IP -> fail is fine)
  const check = await fetch(`${base}/api/v1/proxy/check`, {
    method: 'POST', headers, body: JSON.stringify({ proxy_id: webshare.proxy_id }),
  }).then((r) => r.json());
  ok('PROXY CHECK endpoint works', check.code === 0);

  // 5) backups list (may be empty on fresh dir) + restore validation
  const bl = await fetch(`${base}/api/v1/backups/list`, { headers }).then((r) => r.json());
  ok('BACKUPS LIST endpoint', bl.code === 0 && Array.isArray(bl.data.list), `count=${bl.data?.list?.length}`);
  const badRestore = await fetch(`${base}/api/v1/backups/restore`, {
    method: 'POST', headers, body: JSON.stringify({ name: '../evil.db' }),
  }).then((r) => r.json());
  ok('RESTORE rejects invalid name', badRestore.code === -1);

  // cleanup created proxies
  for (const p of list.data.list) {
    await fetch(`${base}/api/v1/proxy/delete`, { method: 'POST', headers, body: JSON.stringify({ proxy_id: p.proxy_id }) });
  }
  console.log(`\nRESULT: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('VERIFY FAILED', err); process.exit(1); });
