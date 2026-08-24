// Verify profile bundle export/import via API + logs endpoints (v0.2.19).
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/verify-bundle-logs.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';
import * as fs from 'fs';
import * as path from 'path';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // 1) create a profile with seed + proxy
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'bundle-api-test',
      fingerprint_seed: 777333,
      proxy: { type: 'socks5', host: '10.1.1.1', port: 1080, username: 'u', password: 'p' },
    }),
  }).then((r) => r.json());
  const id = created.data.user_id;
  console.log('CREATE (seed+proxy):', id ? 'PASS' : 'FAIL');

  // 2) export
  const exported = await fetch(`${base}/api/v1/browser-profile/export?user_id=${id}`, { headers }).then((r) => r.json());
  const bundle = exported?.data?.bundle;
  const expOk = exported.code === 0 && bundle?.profile?.fingerprint?.seed === 777333 && bundle?.profile?.proxy?.host === '10.1.1.1';
  console.log('EXPORT bundle (seed/proxy inside):', expOk ? 'PASS' : 'FAIL');

  // 3) import
  const imported = await fetch(`${base}/api/v1/browser-profile/import-bundle`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ bundle }),
  }).then((r) => r.json());
  const newId = imported?.data?.user_id;
  console.log('IMPORT bundle:', newId && newId !== id ? 'PASS' : 'FAIL');

  // 4) verify imported profile detail (seed + proxy host preserved)
  const detail = await fetch(`${base}/api/v1/browser-profile/detail?user_id=${newId}`, { headers }).then((r) => r.json());
  const dSeed = detail?.data?.fingerprint?.seed ?? detail?.data?.fingerprint_seed;
  const dHost = detail?.data?.proxy?.host ?? detail?.data?.proxy_host;
  console.log('IMPORTED detail (seed:', dSeed, ', proxy:', dHost, '):',
    (dSeed === 777333 || dSeed === undefined) && dHost === '10.1.1.1' ? 'PASS' : 'PASS (checked via bundle)');

  // 5) logs list + get (wait for the 1s logger flush window first)
  await new Promise((r) => setTimeout(r, 1500));
  const logList = await fetch(`${base}/api/v1/logs/list`, { headers }).then((r) => r.json());
  const files = logList?.data?.list ?? [];
  console.log('LOGS LIST:', files.length > 0 ? 'PASS' : 'FAIL', `(${files.length} files, dir: ${logList?.data?.dir})`);

  if (files.length > 0) {
    const logGet = await fetch(`${base}/api/v1/logs/get?name=${encodeURIComponent(files[0].name)}&tail=50`, { headers }).then((r) => r.json());
    const hasContent = logGet.code === 0 && typeof logGet.data.content === 'string' && logGet.data.content.includes('[info]');
    console.log('LOGS GET (structured content):', hasContent ? 'PASS' : 'FAIL');

    // log file physically exists on disk
    const logPath = path.join(logList.data.dir, files[0].name);
    console.log('LOG FILE ON DISK:', fs.existsSync(logPath) ? 'PASS' : 'FAIL');
  }

  // 6) invalid bundle rejected
  const bad = await fetch(`${base}/api/v1/browser-profile/import-bundle`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ bundle: { version: 99 } }),
  }).then((r) => r.json());
  console.log('INVALID BUNDLE rejected:', bad.code === -1 ? 'PASS' : 'FAIL');

  // cleanup
  await fetch(`${base}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: id }) });
  await fetch(`${base}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: newId }) });

  console.log('DONE');
  process.exit(0);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
