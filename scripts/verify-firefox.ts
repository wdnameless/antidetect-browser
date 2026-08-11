// Camoufox (Firefox) integration verification via the managed API.
// Run: $env:ANTIDETECT_DATA_DIR="<temp>"; $env:API_PORT="50375"; npx tsx scripts/verify-firefox.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  // 1. Create a firefox profile
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'firefox-test', browser_type: 'firefox' }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  if (!id) throw new Error(`create failed: ${JSON.stringify(created)}`);
  console.log('profile created:', id, '(firefox)');

  // 2. Start (managed firefox)
  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  console.log('start:', JSON.stringify(started));
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);

  // 3. Navigate
  const nav = await fetch(`${base}/api/v1/browser/firefox/navigate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: id, url: 'https://example.com' }),
  }).then((r) => r.json());
  console.log('navigate:', JSON.stringify(nav));

  // 4. Evaluate
  const ev = await fetch(`${base}/api/v1/browser/firefox/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: id, expression: 'navigator.userAgent' }),
  }).then((r) => r.json());
  console.log('evaluate (UA):', JSON.stringify(ev));

  // 5. Title
  const title = await fetch(`${base}/api/v1/browser/firefox/title?user_id=${id}`, { headers }).then((r) =>
    r.json()
  );
  console.log('title:', JSON.stringify(title));

  // 6. Stop
  const stopped = await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers }).then((r) => r.json());
  console.log('stop:', JSON.stringify(stopped));

  const ok =
    started?.code === 0 &&
    nav?.code === 0 &&
    ev?.code === 0 &&
    typeof ev?.data?.result === 'string' &&
    (ev.data.result.includes('Camoufox') || ev.data.result.includes('rv:152')) &&
    title?.code === 0 &&
    stopped?.code === 0;
  console.log('FIREFOX:', ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  console.error('FIREFOX TEST FAILED', err);
  process.exit(1);
});
