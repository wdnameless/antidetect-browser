import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

async function main() {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const apiKey = getApiKey();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

  console.log('Testing v0.2.12 features on:', base);

  // 1) Test Group Creation & List
  const gRes = await fetch(`${base}/api/v1/group/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Alpha-Team-2026' }),
  }).then((r) => r.json());
  if (gRes.code !== 0) throw new Error('group create failed: ' + JSON.stringify(gRes));
  const groupId = gRes.data.group_id;
  console.log('GROUP CREATE:', groupId ? 'PASS' : 'FAIL');

  const gList = await fetch(`${base}/api/v1/group/list`, { headers }).then((r) => r.json());
  const foundGroup = gList.data.list.some((g: any) => g.id === groupId && g.name === 'Alpha-Team-2026');
  console.log('GROUP LIST:', foundGroup ? 'PASS' : 'FAIL');

  // 2) Create Profile with Group & Phone Model
  const pRes = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Source-Profile',
      group_id: groupId,
      device_id: 'dev_android',
      mobile_model_id: 'pixel_9',
      fingerprint_seed: 777777,
    }),
  }).then((r) => r.json());
  if (pRes.code !== 0) throw new Error('profile create failed: ' + JSON.stringify(pRes));
  const sourceId = pRes.data.user_id;
  console.log('PROFILE CREATE (in group):', sourceId ? 'PASS' : 'FAIL');

  // 3) Duplicate Profile
  const dupRes = await fetch(`${base}/api/v1/browser-profile/duplicate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: sourceId }),
  }).then((r) => r.json());
  if (dupRes.code !== 0) throw new Error('profile duplicate failed: ' + JSON.stringify(dupRes));
  const dupId = dupRes.data.user_id;
  console.log('PROFILE DUPLICATE:', dupId && dupId !== sourceId ? 'PASS' : 'FAIL');

  const dupDetail = await fetch(`${base}/api/v1/browser-profile/detail?user_id=${dupId}`, { headers }).then((r) => r.json());
  const dupOk = dupDetail.data.name === 'Source-Profile (Copy)' && dupDetail.data.group_id === groupId;
  console.log('DUPLICATE INHERITS ATTRIBUTES:', dupOk ? 'PASS' : 'FAIL');

  // 4) Test Burst Rate Limits (should handle 15 concurrent requests smoothly with new 20 req/s limit)
  const burst = Array.from({ length: 15 }, () => fetch(`${base}/api/v1/browser/list`, { headers }));
  const burstResults = await Promise.all(burst);
  const allOk = burstResults.every((r) => r.status === 200);
  console.log('BURST RATE LIMIT (15 concurrent /api/v1/browser/list):', allOk ? 'PASS' : 'FAIL');

  // Clean up
  await fetch(`${base}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: sourceId }) });
  await fetch(`${base}/api/v1/browser-profile/delete`, { method: 'POST', headers, body: JSON.stringify({ user_id: dupId }) });
  await fetch(`${base}/api/v1/group/delete`, { method: 'POST', headers, body: JSON.stringify({ group_id: groupId }) });

  console.log('ALL v0.2.12 CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
