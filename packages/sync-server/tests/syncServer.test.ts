import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { DbManager } from '../src/db';
import { createServer } from '../src/server';
import {
  generateMasterKey,
  deriveTeamKey,
  encryptBundle,
  decryptBundle,
} from '../../../src/main/teams/teamCrypto';

describe('packages/sync-server: Full Parity Suite', () => {
  let dbManager: DbManager;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbManager = new DbManager();
    const db = await dbManager.init(); // in-memory
    const app = createServer({
      db,
      rateLimitWindowMs: 1000,
      rateLimitMax: 1000, // relaxed for tests
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    dbManager.close();
  });

  async function postJson(
    urlPath: string,
    body: any,
    token?: string
  ): Promise<{ status: number; json: any }> {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  async function getJson(
    urlPath: string,
    token?: string
  ): Promise<{ status: number; json: any }> {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  it('1. Protocol round-trip against syncClient wire protocol (byte-identical ciphertext)', async () => {
    // 1. Create workspace
    const createRes = await postJson('/api/v1/workspaces', {
      workspace_id: 'ws_roundtrip',
      owner_id: 'user_alice',
      name: 'Roundtrip Test',
    });
    expect(createRes.status).toBe(200);
    expect(createRes.json.code).toBe(0);
    const ownerToken = createRes.json.data.token;
    expect(ownerToken).toBeDefined();

    // 2. Encrypt mock bundle using syncClient / teamCrypto conventions
    const masterKey = generateMasterKey();
    const teamKey = deriveTeamKey(masterKey, 'ws_roundtrip');
    const mockBundle = {
      manifest: { version: 1, exported_at: Date.now() },
      profile: { user_id: 'prof_123', name: 'Profile 1' },
      cookies: [{ domain: '.example.com', name: 'sid', value: 'secret' }],
    };
    const plaintextBuffer = Buffer.from(JSON.stringify(mockBundle), 'utf8');
    const encryptedBlob = encryptBundle(teamKey, plaintextBuffer);
    const ciphertextBase64 = encryptedBlob.toString('base64');

    // 3. Push bundle to sync-server
    const pushRes = await postJson(
      '/api/v1/workspaces/ws_roundtrip/bundles',
      {
        bundle_id: 'prof_123',
        device_id: 'dev_laptop',
        ciphertext: ciphertextBase64,
        updated_at: 100000,
      },
      ownerToken
    );
    expect(pushRes.status).toBe(200);
    expect(pushRes.json.code).toBe(0);
    expect(pushRes.json.data.version).toBe(1);

    // Also verify legacy alias /api/v1/teams/:id/bundles works identically
    const pullRes = await getJson(
      '/api/v1/teams/ws_roundtrip/bundles?since=0',
      ownerToken
    );
    expect(pullRes.status).toBe(200);
    expect(pullRes.json.code).toBe(0);
    expect(pullRes.json.data.list.length).toBe(1);

    const pulledRow = pullRes.json.data.list[0];
    expect(pulledRow.bundle_id).toBe('prof_123');
    // Ciphertext must be byte-for-byte identical
    expect(pulledRow.ciphertext).toBe(ciphertextBase64);

    // Decrypt locally with team key
    const decryptedBytes = decryptBundle(
      teamKey,
      Buffer.from(pulledRow.ciphertext, 'base64')
    );
    const recovered = JSON.parse(decryptedBytes.toString('utf8'));
    expect(recovered).toEqual(mockBundle);
  });

  it('2. Per-workspace namespacing (workspace-forbidden on cross-access)', async () => {
    // Create Workspace A
    const wsA = await postJson('/api/v1/workspaces', {
      workspace_id: 'ws_alpha',
      owner_id: 'owner_a',
    });
    const tokenA = wsA.json.data.token;

    // Create Workspace B
    const wsB = await postJson('/api/v1/workspaces', {
      workspace_id: 'ws_beta',
      owner_id: 'owner_b',
    });
    const tokenB = wsB.json.data.token;

    // Push bundle to Workspace A with Token A
    const pushA = await postJson(
      '/api/v1/workspaces/ws_alpha/bundles',
      {
        bundle_id: 'bundle_alpha',
        ciphertext: Buffer.from('cipher-a').toString('base64'),
      },
      tokenA
    );
    expect(pushA.status).toBe(200);

    // Try to access Workspace A using Token B -> workspace-forbidden
    const pullCross = await getJson(
      '/api/v1/workspaces/ws_alpha/bundles',
      tokenB
    );
    expect(pullCross.status).toBe(403);
    expect(pullCross.json.code).toBe('workspace-forbidden');

    // Try to push to Workspace B using Token A -> workspace-forbidden
    const pushCross = await postJson(
      '/api/v1/workspaces/ws_beta/bundles',
      {
        bundle_id: 'bundle_hack',
        ciphertext: Buffer.from('hack').toString('base64'),
      },
      tokenA
    );
    expect(pushCross.status).toBe(403);
    expect(pushCross.json.code).toBe('workspace-forbidden');
  });

  it('3. RBAC owner/editor/viewer deny-by-default matrix', async () => {
    // 1. Create workspace with owner
    const wsRes = await postJson('/api/v1/workspaces', {
      workspace_id: 'ws_rbac',
      owner_id: 'alice_owner',
    });
    const ownerToken = wsRes.json.data.token;

    // 2. Owner adds editor member
    const editorRes = await postJson(
      '/api/v1/workspaces/ws_rbac/members',
      { user_id: 'bob_editor', role: 'editor' },
      ownerToken
    );
    expect(editorRes.status).toBe(200);
    const editorToken = editorRes.json.data.token;

    // 3. Owner adds viewer member
    const viewerRes = await postJson(
      '/api/v1/workspaces/ws_rbac/members',
      { user_id: 'charlie_viewer', role: 'viewer' },
      ownerToken
    );
    expect(viewerRes.status).toBe(200);
    const viewerToken = viewerRes.json.data.token;

    // 4. Viewer attempts to add member -> role-denied (only owner can add members)
    const viewerAdd = await postJson(
      '/api/v1/workspaces/ws_rbac/members',
      { user_id: 'dave', role: 'viewer' },
      viewerToken
    );
    expect(viewerAdd.status).toBe(403);
    expect(viewerAdd.json.code).toBe('role-denied');

    // 5. Editor attempts to add member -> role-denied
    const editorAdd = await postJson(
      '/api/v1/workspaces/ws_rbac/members',
      { user_id: 'eve', role: 'viewer' },
      editorToken
    );
    expect(editorAdd.status).toBe(403);
    expect(editorAdd.json.code).toBe('role-denied');

    // 6. Viewer attempts to push bundle -> role-denied
    const viewerPush = await postJson(
      '/api/v1/workspaces/ws_rbac/bundles',
      {
        bundle_id: 'viewer_bundle',
        ciphertext: Buffer.from('payload').toString('base64'),
      },
      viewerToken
    );
    expect(viewerPush.status).toBe(403);
    expect(viewerPush.json.code).toBe('role-denied');

    // 7. Editor pushes bundle -> success
    const editorPush = await postJson(
      '/api/v1/workspaces/ws_rbac/bundles',
      {
        bundle_id: 'editor_bundle',
        ciphertext: Buffer.from('payload_edit').toString('base64'),
      },
      editorToken
    );
    expect(editorPush.status).toBe(200);
    expect(editorPush.json.code).toBe(0);

    // 8. Viewer pulls bundles -> success (viewer can pull)
    const viewerPull = await getJson(
      '/api/v1/workspaces/ws_rbac/bundles',
      viewerToken
    );
    expect(viewerPull.status).toBe(200);
    expect(viewerPull.json.data.list.length).toBe(1);
    expect(viewerPull.json.data.list[0].bundle_id).toBe('editor_bundle');

    // 9. Unauthenticated request -> 401 UNAUTHORIZED
    const unauthPull = await getJson('/api/v1/workspaces/ws_rbac/bundles');
    expect(unauthPull.status).toBe(401);
    expect(unauthPull.json.code).toBe('UNAUTHORIZED');
  });

  it('4. Versioned bundle storage & Last-Write-Wins conflict determinism', async () => {
    const wsRes = await postJson('/api/v1/workspaces', {
      workspace_id: 'ws_conflicts',
      owner_id: 'owner1',
    });
    const token = wsRes.json.data.token;

    // Push initial version v1 at t=100
    const p1 = await postJson(
      '/api/v1/workspaces/ws_conflicts/bundles',
      {
        bundle_id: 'bundle_x',
        ciphertext: Buffer.from('v1').toString('base64'),
        updated_at: 100,
      },
      token
    );
    expect(p1.json.data.version).toBe(1);
    expect(p1.json.data.applied).toBe(true);

    // Push newer version at t=200 -> applied, becomes v2
    const p2 = await postJson(
      '/api/v1/workspaces/ws_conflicts/bundles',
      {
        bundle_id: 'bundle_x',
        ciphertext: Buffer.from('v2').toString('base64'),
        updated_at: 200,
      },
      token
    );
    expect(p2.json.data.version).toBe(2);
    expect(p2.json.data.applied).toBe(true);

    // Push stale write at t=150 (older than existing 200) -> rejected / ignored
    const pStale = await postJson(
      '/api/v1/workspaces/ws_conflicts/bundles',
      {
        bundle_id: 'bundle_x',
        ciphertext: Buffer.from('stale').toString('base64'),
        updated_at: 150,
      },
      token
    );
    expect(pStale.json.data.applied).toBe(false);
    expect(pStale.json.data.version).toBe(2);

    // Verify pull reflects winning v2
    const pull = await getJson(
      '/api/v1/workspaces/ws_conflicts/bundles',
      token
    );
    expect(pull.json.data.list[0].version).toBe(2);
    expect(
      Buffer.from(pull.json.data.list[0].ciphertext, 'base64').toString('utf8')
    ).toBe('v2');
  });

  it('5. Corrupted bundle rejection', async () => {
    const wsRes = await postJson('/api/v1/workspaces', {
      workspace_id: 'ws_corrupt',
      owner_id: 'owner1',
    });
    const token = wsRes.json.data.token;

    // Send invalid non-base64 ciphertext
    const badPush = await postJson(
      '/api/v1/workspaces/ws_corrupt/bundles',
      {
        bundle_id: 'corrupt_1',
        ciphertext: '!!not_base_64##&&',
        updated_at: Date.now(),
      },
      token
    );
    expect(badPush.status).toBe(400);
    expect(badPush.json.code).toBe('CORRUPTED_BUNDLE');

    // Missing bundle_id
    const missingId = await postJson(
      '/api/v1/workspaces/ws_corrupt/bundles',
      {
        ciphertext: Buffer.from('valid').toString('base64'),
      },
      token
    );
    expect(missingId.status).toBe(400);
    expect(missingId.json.code).toBe('INVALID_INPUT');
  });

  it('6. Audit log completeness', async () => {
    const wsRes = await postJson('/api/v1/workspaces', {
      workspace_id: 'ws_audit',
      owner_id: 'audit_owner',
    });
    const ownerToken = wsRes.json.data.token;

    // 1. Add viewer
    const addViewer = await postJson(
      '/api/v1/workspaces/ws_audit/members',
      { user_id: 'viewer_guy', role: 'viewer' },
      ownerToken
    );
    const viewerToken = addViewer.json.data.token;

    // 2. Successful Push
    await postJson(
      '/api/v1/workspaces/ws_audit/bundles',
      {
        bundle_id: 'bundle_ok',
        ciphertext: Buffer.from('ok').toString('base64'),
      },
      ownerToken
    );

    // 3. Successful Pull
    await getJson('/api/v1/workspaces/ws_audit/bundles', ownerToken);

    // 4. Denied Push from Viewer
    await postJson(
      '/api/v1/workspaces/ws_audit/bundles',
      {
        bundle_id: 'bundle_denied',
        ciphertext: Buffer.from('denied').toString('base64'),
      },
      viewerToken
    );

    // Query audit logs
    const auditRes = await getJson(
      '/api/v1/workspaces/ws_audit/audit',
      ownerToken
    );
    expect(auditRes.status).toBe(200);
    const logs = auditRes.json.data.list as Array<{
      action: string;
      outcome: string;
      actor: string;
      bundle_id: string | null;
    }>;

    expect(logs.length).toBeGreaterThanOrEqual(4);

    const deniedPush = logs.find(
      (l) => l.action === 'bundle_push' && l.outcome === 'denied'
    );
    expect(deniedPush).toBeDefined();
    expect(deniedPush?.actor).toBe('viewer_guy');

    const okPush = logs.find(
      (l) => l.action === 'bundle_push' && l.outcome === 'success'
    );
    expect(okPush).toBeDefined();

    const okPull = logs.find(
      (l) => l.action === 'bundle_pull' && l.outcome === 'success'
    );
    expect(okPull).toBeDefined();
  });

  it('7. Rate limiting enforcement', async () => {
    // Create new app with tiny rate limit
    const tightApp = createServer({
      db: dbManager.getDb(),
      rateLimitWindowMs: 60000,
      rateLimitMax: 3,
    });

    const tightServer = await new Promise<http.Server>((resolve) => {
      const s = tightApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (tightServer.address() as AddressInfo).port;
    const tightUrl = `http://127.0.0.1:${port}`;

    try {
      // 3 requests within limit
      for (let i = 0; i < 3; i++) {
        const r = await fetch(`${tightUrl}/status`);
        expect(r.status).toBe(200);
      }

      // 4th request trips rate limit
      const tripped = await fetch(`${tightUrl}/status`);
      expect(tripped.status).toBe(429);
      const json = await tripped.json();
      expect(json.code).toBe('RATE_LIMIT_EXCEEDED');
    } finally {
      await new Promise<void>((resolve) => tightServer.close(() => resolve()));
    }
  });

  it('8. E2E two-client sync with forced conflict', async () => {
    // Client A (Alice, owner) and Client B (Bob, editor)
    const wsRes = await postJson('/api/v1/workspaces', {
      workspace_id: 'ws_e2e_sync',
      owner_id: 'client_alice',
    });
    const aliceToken = wsRes.json.data.token;

    const bobRes = await postJson(
      '/api/v1/workspaces/ws_e2e_sync/members',
      { user_id: 'client_bob', role: 'editor' },
      aliceToken
    );
    const bobToken = bobRes.json.data.token;

    const masterKey = generateMasterKey();
    const teamKey = deriveTeamKey(masterKey, 'ws_e2e_sync');

    // Alice pushes initial profile at t=1000
    const profileAlice = { name: 'Alice Base Profile', updated: 1000 };
    const encAlice = encryptBundle(
      teamKey,
      Buffer.from(JSON.stringify(profileAlice), 'utf8')
    );

    const pushAlice = await postJson(
      '/api/v1/workspaces/ws_e2e_sync/bundles',
      {
        bundle_id: 'shared_profile',
        device_id: 'alice_laptop',
        ciphertext: encAlice.toString('base64'),
        updated_at: 1000,
      },
      aliceToken
    );
    expect(pushAlice.json.data.version).toBe(1);

    // Bob pulls at since=0, gets version 1
    const bobPull1 = await getJson(
      '/api/v1/workspaces/ws_e2e_sync/bundles?since=0',
      bobToken
    );
    expect(bobPull1.json.data.list.length).toBe(1);
    const rowBob = bobPull1.json.data.list[0];
    const decBob = JSON.parse(
      decryptBundle(
        teamKey,
        Buffer.from(rowBob.ciphertext, 'base64')
      ).toString('utf8')
    );
    expect(decBob.name).toBe('Alice Base Profile');

    // Forced Concurrent Conflict:
    // Alice modifies profile offline with timestamp t=2000
    const profileAliceV2 = { name: 'Alice Updated', updated: 2000 };
    const encAliceV2 = encryptBundle(
      teamKey,
      Buffer.from(JSON.stringify(profileAliceV2), 'utf8')
    );

    // Bob modifies profile with later timestamp t=3000 (Bob wins LWW)
    const profileBobV2 = { name: 'Bob Wins', updated: 3000 };
    const encBobV2 = encryptBundle(
      teamKey,
      Buffer.from(JSON.stringify(profileBobV2), 'utf8')
    );

    // Bob pushes first at t=3000
    const pushBob = await postJson(
      '/api/v1/workspaces/ws_e2e_sync/bundles',
      {
        bundle_id: 'shared_profile',
        device_id: 'bob_desktop',
        ciphertext: encBobV2.toString('base64'),
        updated_at: 3000,
      },
      bobToken
    );
    expect(pushBob.json.data.version).toBe(2);
    expect(pushBob.json.data.applied).toBe(true);

    // Alice attempts to push her older edit (t=2000 < 3000)
    const pushAliceStale = await postJson(
      '/api/v1/workspaces/ws_e2e_sync/bundles',
      {
        bundle_id: 'shared_profile',
        device_id: 'alice_laptop',
        ciphertext: encAliceV2.toString('base64'),
        updated_at: 2000,
      },
      aliceToken
    );
    expect(pushAliceStale.json.data.applied).toBe(false);
    expect(pushAliceStale.json.data.version).toBe(2);

    // Alice performs a pull: learns Bob's winning version 2
    const alicePull = await getJson(
      '/api/v1/workspaces/ws_e2e_sync/bundles?since=1000',
      aliceToken
    );
    expect(alicePull.json.data.list.length).toBe(1);
    const winningRow = alicePull.json.data.list[0];
    expect(winningRow.version).toBe(2);
    expect(winningRow.updated_at).toBe(3000);
    const winningPayload = JSON.parse(
      decryptBundle(
        teamKey,
        Buffer.from(winningRow.ciphertext, 'base64')
      ).toString('utf8')
    );
    expect(winningPayload.name).toBe('Bob Wins');
  });
});
