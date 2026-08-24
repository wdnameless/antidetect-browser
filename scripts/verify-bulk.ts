// Verify server-side bulk endpoints (v0.2.18): bulk-start, bulk-stop, bulk-group,
// bulk-delete — one request per action with per-item success/failure report.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/verify-bulk.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // 1) Server-side pagination + search on the list endpoint
  const page1 = await fetch(`${base}/api/v1/browser/list?page=1&page_size=10`, { headers }).then((r) => r.json());
  console.log('PAGINATION page1 rows:', page1.data.list.length, 'total:', page1.data.total,
    page1.data.list.length === 10 ? 'PASS' : 'FAIL');

  const searched = await fetch(`${base}/api/v1/browser/list?search=smoke-test`, { headers }).then((r) => r.json());
  console.log('SEARCH smoke-test:', searched.data.total, 'rows, all match:',
    searched.data.list.every((p: { name: string | null }) => (p.name || '').includes('smoke-test')) ? 'PASS' : 'FAIL');

  // 2) Create 3 profiles for bulk tests
  const ids: string[] = [];
  for (const name of ['bulk-a', 'bulk-b', 'bulk-c']) {
    const created = await fetch(`${base}/api/v1/browser-profile/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    }).then((r) => r.json());
    ids.push(created.data.user_id);
  }
  console.log('CREATED 3 profiles:', ids.length === 3 ? 'PASS' : 'FAIL');

  // 3) bulk-start on two of them (single request)
  const startRes = await fetch(`${base}/api/v1/browser-profile/bulk-start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_ids: [ids[0], ids[1]] }),
  }).then((r) => r.json());
  const startOk = startRes.code === 0 && startRes.data.succeeded.length === 2 && startRes.data.failed.length === 0;
  console.log('BULK-START (2 in 1 request):', startOk ? 'PASS' : 'FAIL', JSON.stringify(startRes.data).slice(0, 120));

  const list1 = await fetch(`${base}/api/v1/browser/list?search=bulk-`, { headers }).then((r) => r.json());
  const runningCount = list1.data.list.filter((p: { status: string }) => p.status === 'running').length;
  console.log('STATUS after bulk-start (2 running):', runningCount === 2 ? 'PASS' : 'FAIL');

  // 4) bulk-stop all three
  const stopRes = await fetch(`${base}/api/v1/browser-profile/bulk-stop`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_ids: ids }),
  }).then((r) => r.json());
  const stopOk = stopRes.code === 0 && stopRes.data.succeeded.length === 3;
  console.log('BULK-STOP (3 in 1 request):', stopOk ? 'PASS' : 'FAIL');

  // 5) bulk-group: move all into one group
  const group = await fetch(`${base}/api/v1/group/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'bulk-test-group' }),
  }).then((r) => r.json());
  const groupRes = await fetch(`${base}/api/v1/browser-profile/bulk-group`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_ids: ids, group_id: group.data.group_id }),
  }).then((r) => r.json());
  console.log('BULK-GROUP (3 moved):', groupRes.data.succeeded.length === 3 ? 'PASS' : 'FAIL');

  // 6) bulk-delete: remove all three + failure report for a non-existent id
  const delRes = await fetch(`${base}/api/v1/browser-profile/bulk-delete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_ids: [...ids, 'p_does-not-exist'] }),
  }).then((r) => r.json());
  const delOk = delRes.data.succeeded.length === 3 &&
    delRes.data.failed.length === 1 &&
    delRes.data.failed[0].user_id === 'p_does-not-exist';
  console.log('BULK-DELETE (3 ok + 1 reported fail):', delOk ? 'PASS' : 'FAIL');

  // cleanup group
  await fetch(`${base}/api/v1/group/delete`, { method: 'POST', headers, body: JSON.stringify({ group_id: group.data.group_id }) });

  const all = ['PAGINATION', 'SEARCH', 'CREATED', 'BULK-START', 'STATUS', 'BULK-STOP', 'BULK-GROUP', 'BULK-DELETE'];
  console.log('DONE');
  void all;
  process.exit(0);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
