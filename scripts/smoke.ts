// Phase 0 backend smoke test (no browser launch required).
// Run: $env:ANTIDETECT_DATA_DIR="<temp>"; npx tsx scripts/smoke.ts
import * as fs from 'fs';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT, getChromiumPath } from '../src/main/config';

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  };

  const status = await fetch(`${base}/status`).then((r) => r.json());
  console.log('STATUS   :', JSON.stringify(status));

  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'smoke-test',
      proxy: { type: 'socks5', host: '127.0.0.1', port: 1080 },
    }),
  }).then((r) => r.json());
  console.log('CREATE   :', JSON.stringify(created));
  const profileId: string = created?.data?.user_id;

  const list = await fetch(`${base}/api/v1/browser/list`, { headers }).then((r) => r.json());
  console.log('LIST     : total =', list?.data?.total, '| first =', JSON.stringify(list?.data?.list?.[0]));

  const unauth = await fetch(`${base}/api/v1/browser/list`).then((r) => r.json());
  console.log('UNAUTH   : (expect code -1) ', JSON.stringify(unauth));

  // Optional: attempt a real browser start only if a Chromium/Chrome binary is resolvable.
  const exe = getChromiumPath();
  if (exe && fs.existsSync(exe) && profileId) {
    try {
      const started = await fetch(`${base}/api/v1/browser/start?user_id=${profileId}`, { headers }).then((r) =>
        r.json()
      );
      console.log('START    :', JSON.stringify(started));
      if (started?.code === 0) {
        const stopped = await fetch(`${base}/api/v1/browser/stop?user_id=${profileId}`, { headers }).then((r) =>
          r.json()
        );
        console.log('STOP     :', JSON.stringify(stopped));
      }
    } catch (err) {
      console.log('START    : skipped/failed ->', (err as Error).message);
    }
  } else {
    console.log('START    : skipped (no Chromium binary found at', exe + ')');
  }

  console.log('\nSMOKE OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE FAILED', err);
  process.exit(1);
});
