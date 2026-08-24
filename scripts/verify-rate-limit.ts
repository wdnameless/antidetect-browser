// Verify rate limits (updated for the v0.2.12 limits: lists 20/s, start/stop 10/s,
// default 20/s) + SDK auto-retry on 429.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/verify-rate-limit.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // 1) Lists allow bursts up to 20/s: 15 rapid calls must ALL succeed (UI burst safety).
  const burstStatuses: number[] = [];
  for (let i = 0; i < 15; i++) {
    const res = await fetch(`${base}/api/v1/browser/list`, { headers });
    burstStatuses.push(res.status);
  }
  const burstOk = burstStatuses.every((s) => s === 200);
  console.log('list statuses (15 rapid):', burstStatuses.join(','));
  console.log('RATE LIMIT (list burst 15 < 20/s):', burstOk ? 'PASS' : 'FAIL');

  // 2) Limit still kicks in: 30 rapid calls (limit 20/s) must produce at least one 429.
  const hammerStatuses: number[] = [];
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${base}/api/v1/browser/list`, { headers });
    hammerStatuses.push(res.status);
  }
  const hammerOk = hammerStatuses.includes(429);
  console.log('429 present in 30 rapid calls:', hammerOk);
  console.log('RATE LIMIT (enforced above 20/s):', hammerOk ? 'PASS' : 'FAIL');

  // 3) Start limit: 15 rapid starts (limit 10/s) -> some succeed, some 429 (not all fail).
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'rate-start-test' }),
  }).then((r) => r.json());
  const pid = created?.data?.user_id;
  const statuses: number[] = [];
  for (let i = 0; i < 15; i++) {
    const res = await fetch(`${base}/api/v1/browser/start?user_id=${pid}`, { headers });
    statuses.push(res.status);
  }
  const okCount = statuses.filter((s) => s === 200).length;
  const limited = statuses.includes(429);
  console.log('start statuses (15 rapid):', statuses.join(','));
  const startRateOk = okCount >= 1 && limited;
  console.log('RATE LIMIT (start 10/s):', startRateOk ? 'PASS' : 'FAIL');
  await fetch(`${base}/api/v1/browser/stop?user_id=${pid}`, { headers });

  // 4) SDK auto-retry: hammer list 3x fast; SDK must succeed all 3 (retries on 429).
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

  process.exit(burstOk && hammerOk && startRateOk && sdkOk ? 0 : 2);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
