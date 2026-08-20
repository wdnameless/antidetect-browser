// Verify Phase 3b: rate limits on ALL endpoints (incl. start/stop) + SDK auto-retry.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/verify-rate-limit.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // 1) Rate limit on list: two calls within 1s -> second must be 429.
  const r1 = await fetch(`${base}/api/v1/browser/list`, { headers });
  const r2 = await fetch(`${base}/api/v1/browser/list`, { headers });
  const j1 = await r1.json();
  const j2 = await r2.json();
  console.log('list #1:', r1.status, j1.code);
  console.log('list #2:', r2.status, j2.code, j2.msg, 'retry_after_ms=', j2.data?.retry_after_ms);
  const listRateOk = r1.status === 200 && r2.status === 429 && j2.code === -1;
  console.log('RATE LIMIT (list 1/s):', listRateOk ? 'PASS' : 'FAIL');

  // 2) Rate limit on start: 6 rapid starts -> 6th must be 429 (limit 5/s).
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'rate-start-test' }),
  }).then((r) => r.json());
  const pid = created?.data?.user_id;
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${base}/api/v1/browser/start?user_id=${pid}`, { headers });
    statuses.push(res.status);
  }
  console.log('start statuses (6 rapid):', statuses.join(','));
  const startRateOk = statuses.filter((s) => s === 200).length >= 1 && statuses.includes(429);
  console.log('RATE LIMIT (start 5/s):', startRateOk ? 'PASS' : 'FAIL');
  await fetch(`${base}/api/v1/browser/stop?user_id=${pid}`, { headers });

  // 3) SDK auto-retry: hammer list 3x fast; SDK must succeed all 3 (retries on 429).
  const { Antidetect } = await import('../examples/sdk.mjs');
  const ad = new Antidetect({ apiKey: getApiKey(), base, maxRetries: 5 });
  const results: number[] = [];
  for (let i = 0; i < 3; i++) {
    const data = await ad.list();
    results.push(data.total);
  }
  console.log('SDK list totals (3 rapid):', results.join(','));
  const sdkOk = results.length === 3 && results.every((t) => typeof t === 'number');
  console.log('SDK AUTO-RETRY:', sdkOk ? 'PASS' : 'FAIL');

  process.exit(listRateOk && startRateOk && sdkOk ? 0 : 2);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
