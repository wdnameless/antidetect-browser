// Verify Phase 3: AdsPower-parity rate limits + SDK helper with auto-retry.
// Run: $env:ANTIDETECT_DATA_DIR="D:\WORK\antidetect browser\data"; $env:API_PORT="50331"; npx tsx scripts/verify-rate-limit.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // 1) Rate limit: two list calls within 1s -> second must be 429.
  const r1 = await fetch(`${base}/api/v1/browser/list`, { headers });
  const r2 = await fetch(`${base}/api/v1/browser/list`, { headers });
  const j1 = await r1.json();
  const j2 = await r2.json();
  console.log('first list:', r1.status, j1.code);
  console.log('second list:', r2.status, j2.code, j2.msg, 'retry_after_ms=', j2.data?.retry_after_ms);
  const rateOk = r1.status === 200 && r2.status === 429 && j2.code === -1;
  console.log('RATE LIMIT:', rateOk ? 'PASS' : 'FAIL');

  // 2) SDK helper: create -> start -> puppeteer connect (auto-retry on 429).
  const { Antidetect } = await import('../examples/sdk.mjs');
  const ad = new Antidetect({ apiKey: getApiKey(), base });
  const created = await ad.create({ name: 'sdk-test', start_urls: ['https://example.com/'] });
  const user_id = created.user_id;
  console.log('SDK create:', user_id ? 'PASS' : 'FAIL');

  const browser = await ad.connectPuppeteer(user_id);
  const pages = await browser.pages();
  const urls = pages.map((p) => p.url()).filter((u) => u.startsWith('http'));
  console.log('SDK connectPuppeteer urls:', urls);
  const sdkOk = urls.some((u) => u.includes('example.com'));
  console.log('SDK PUPPETEER + start_urls:', sdkOk ? 'PASS' : 'FAIL');
  browser.disconnect();

  await ad.stop(user_id);
  process.exit(rateOk && sdkOk ? 0 : 2);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err);
  process.exit(1);
});
