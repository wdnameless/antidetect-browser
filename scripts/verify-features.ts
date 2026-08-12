// Verify core user-facing features end-to-end via Local API.
// Run: $env:API_PORT="50342"; npx tsx scripts/verify-features.ts
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';
import { getProfile } from '../src/main/profiles/profileManager';

let KEY = '';
const H = () => ({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
const base = () => `http://${API_HOST}:${API_PORT}`;

async function post(path: string, body: unknown) {
  const r = await fetch(`${base()}${path}`, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  return (await r.json()) as { code: number; msg: string; data: Record<string, unknown> };
}
async function get(path: string) {
  const r = await fetch(`${base()}${path}`, { headers: H() });
  return (await r.json()) as { code: number; msg: string; data: Record<string, unknown> };
}

function ok(label: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) process.exitCode = 2;
}

async function main(): Promise<void> {
  await startService();
  KEY = getApiKey();

  // Groups
  const g = await post('/api/v1/group/create', { name: 'TikTok Farm' });
  ok('group/create', g.code === 0, String(g.data.group_id));
  const gl = await get('/api/v1/group/list');
  const groups = (gl.data.list as Array<{ id: string; name: string }>) ?? [];
  ok('group/list', groups.some((x) => x.name === 'TikTok Farm'));

  // Create profile with name + group
  const c = await post('/api/v1/browser-profile/create', { name: 'acc-001', group_id: (g.data.group_id as string) ?? undefined });
  ok('profile/create (name+group)', c.code === 0, String(c.data.user_id));
  const pid = c.data.user_id as string;

  // Proxy create + bind to profile
  const px = await post('/api/v1/proxy/create', { type: 'http', host: '127.0.0.1', port: 9999, username: 'u', password: 'p' });
  ok('proxy/create', px.code === 0, String(px.data.proxy_id));
  const proxyId = px.data.proxy_id as string;
  const bind = await post('/api/v1/browser-profile/update', { user_id: pid, proxy_id: proxyId });
  ok('profile/update (bind proxy)', bind.code === 0 && getProfile(pid)?.proxy_id === proxyId, `proxy_id=${getProfile(pid)?.proxy_id}`);

  // Rename profile + move group
  const ren = await post('/api/v1/browser-profile/update', { user_id: pid, name: 'acc-001-renamed' });
  ok('profile/update (rename)', ren.code === 0);

  // Randomize fingerprint
  const rnd = await post('/api/v1/browser-profile/randomize-fingerprint', { user_id: pid });
  ok('profile/randomize-fingerprint', rnd.code === 0, `seed=${rnd.data.seed}`);

  // Read back via list to confirm persisted state
  const list = await get('/api/v1/browser/list');
  const item = ((list.data.list as Array<Record<string, unknown>>) ?? []).find((x) => x.user_id === pid);
  ok('profile persisted name', item?.name === 'acc-001-renamed', String(item?.name));
  ok('profile persisted group', Boolean(item?.group_id), String(item?.group_id));

  console.log('\nFEATURE CHECK DONE');
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error('VERIFY FAILED', e);
  process.exit(1);
});
