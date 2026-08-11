// Sprint C verification: batch operations (batch-create, CSV import, batch-bind, batch-delete).
// Run: $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50355"; npx tsx scripts/verify-batch.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // Create two proxies to assign round-robin
  const px1 = await fetch(`${base}/api/v1/proxy/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'http', host: '1.2.3.4', port: 8080 }),
  }).then((r) => r.json());
  const px2 = await fetch(`${base}/api/v1/proxy/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'socks5', host: '5.6.7.8', port: 1080 }),
  }).then((r) => r.json());
  const pxIds: string[] = [px1?.data?.proxy_id, px2?.data?.proxy_id];
  console.log('proxies created:', pxIds.join(', '));

  // Batch-create 3 profiles with round-robin proxies
  const bc = await fetch(`${base}/api/v1/browser-profile/batch-create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ count: 3, name_prefix: 'batch', proxy_ids: pxIds }),
  }).then((r) => r.json());
  console.log('batch-create:', JSON.stringify(bc.data));

  // Verify via list
  const list = await fetch(`${base}/api/v1/browser/list?page_size=200`, { headers }).then((r) => r.json());
  const batchProfiles = (list?.data?.list ?? []).filter((p: { name: string | null }) =>
    (p.name ?? '').startsWith('batch-')
  );
  console.log('batch profiles present:', batchProfiles.length);

  // CSV import (2 profiles with timezone)
  const csv = 'name,timezone\nimp-1,Europe/Sofia\nimp-2,Europe/Paris';
  const imp = await fetch(`${base}/api/v1/browser-profile/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ csv }),
  }).then((r) => r.json());
  console.log('csv import:', JSON.stringify(imp.data));

  // Batch-bind all batch profiles to the first proxy
  const bind = await fetch(`${base}/api/v1/browser-profile/batch-bind-proxy`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_ids: bc.data.user_ids, proxy_ids: [pxIds[0]] }),
  }).then((r) => r.json());
  console.log('batch-bind:', JSON.stringify(bind.data));

  // Batch-delete everything we created
  const allIds = [...bc.data.user_ids, ...imp.data.user_ids];
  const del = await fetch(`${base}/api/v1/browser-profile/batch-delete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_ids: allIds }),
  }).then((r) => r.json());
  console.log('batch-delete:', JSON.stringify(del.data));

  const ok =
    bc.data.count === 3 &&
    batchProfiles.length === 3 &&
    imp.data.count === 2 &&
    bind.data.updated === 3 &&
    del.data.deleted === 5;
  console.log('BATCH:', ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  console.error('BATCH TEST FAILED', err);
  process.exit(1);
});
