// Antidetect Teams Sync Server (Sprint 1) — zero-knowledge team bundle store.
//
// Implements the wire-format v1 REST API (see openspec specs/sync-protocol):
//   POST /api/v1/teams                 create a team (returns server token)
//   POST /api/v1/teams/:id/invites     register a pending invite
//   POST /api/v1/invites/accept        activate the invite (pending -> active)
//   POST /api/v1/teams/:id/bundles     push an encrypted bundle
//   GET  /api/v1/teams/:id/bundles     pull bundles ?since=<ts>
//
// The server is ZERO-KNOWLEDGE: it stores only
//   {bundle_id, team_id, device_id, ciphertext, nonce, version, updated_at}
// and never holds any team key material.
//
// Storage: SQLite via sql.js (WASM, no native modules). Crypto: none needed
// server-side (the payload is opaque ciphertext); only node:crypto for tokens.

import express, { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import { initDb, getDb } from './db';
import { ensureAuthSchema, requireAuth, issueToken } from './auth';

const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(express.json({ limit: '8mb' }));

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/status', (_req, res) => {
  res.json({ code: 0, msg: 'success', data: { status: 'ok', version: '1.0.0', service: 'teams-sync' } });
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

app.post('/api/v1/teams', (req: Request, res: Response) => {
  const { team_id, owner_device_id, name } = req.body ?? {};
  if (typeof team_id !== 'string' || !team_id || typeof owner_device_id !== 'string' || !owner_device_id) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'team_id and owner_device_id are required', data: {} });
    return;
  }
  const db = getDb();
  const dup = db.prepare('SELECT id FROM teams WHERE id = ?').get(team_id);
  if (dup) {
    res.status(409).json({ code: 'ALREADY_EXISTS', msg: 'team already exists', data: {} });
    return;
  }
  db.prepare('INSERT INTO teams (id, name, owner_device_id, created_at) VALUES (?, ?, ?, ?)').run(
    team_id,
    String(name ?? ''),
    owner_device_id,
    Date.now()
  );
  db.prepare(
    "INSERT INTO team_members (team_id, member_id, role, status, created_at) VALUES (?, ?, 'owner', 'active', ?)"
  ).run(team_id, owner_device_id, Date.now());
  res.json({ code: 0, msg: 'success', data: { team_id, token: issueToken(team_id, owner_device_id) } });
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

app.post('/api/v1/teams/:id/invites', requireAuth, (req: Request, res: Response) => {
  const teamId = String(req.params.id);
  const { email, member_id, permissions, key_blob } = req.body ?? {};
  if (typeof email !== 'string' || !email || typeof member_id !== 'string' || !member_id) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'email and member_id are required', data: {} });
    return;
  }
  const db = getDb();
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as Record<string, unknown> | undefined;
  if (!team) {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'team not found', data: {} });
    return;
  }
  const dup = db
    .prepare("SELECT member_id FROM team_members WHERE team_id = ? AND email = ? AND status IN ('pending','active')")
    .get(teamId, String(email).toLowerCase());
  if (dup) {
    res.status(409).json({ code: 'ALREADY_MEMBER', msg: 'email already has a membership', data: {} });
    return;
  }
  db.prepare(
    `INSERT INTO team_members (team_id, member_id, email, role, permissions, status, key_blob, created_at)
     VALUES (?, ?, ?, 'member', ?, 'pending', ?, ?)`
  ).run(
    teamId,
    member_id,
    String(email).toLowerCase(),
    typeof permissions === 'string' ? permissions : JSON.stringify(permissions ?? {}),
    typeof key_blob === 'string' ? key_blob : null,
    Date.now()
  );
  res.json({ code: 0, msg: 'success', data: { member_id } });
});

app.post('/api/v1/invites/accept', (req: Request, res: Response) => {
  const { team_id, email, member_id } = req.body ?? {};
  if (typeof team_id !== 'string' || !team_id || typeof email !== 'string' || !email) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'team_id and email are required', data: {} });
    return;
  }
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM team_members WHERE team_id = ? AND email = ? AND status = 'pending'")
    .get(team_id, String(email).toLowerCase()) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'no pending invite for this email', data: {} });
    return;
  }
  const deviceId = typeof member_id === 'string' && member_id ? member_id : row.member_id;
  db.prepare(
    "UPDATE team_members SET status = 'active', member_id = ?, joined_at = ?, key_blob = NULL WHERE team_id = ? AND email = ?"
  ).run(deviceId, Date.now(), team_id, String(email).toLowerCase());
  res.json({ code: 0, msg: 'success', data: { team_id, token: issueToken(team_id, String(deviceId)) } });
});

// ---------------------------------------------------------------------------
// Bundles (zero-knowledge store)
// ---------------------------------------------------------------------------

app.post('/api/v1/teams/:id/bundles', requireAuth, (req: Request, res: Response) => {
  const teamId = String(req.params.id);
  const { bundle_id, device_id, ciphertext, updated_at } = req.body ?? {};
  if (
    typeof bundle_id !== 'string' ||
    !bundle_id ||
    typeof ciphertext !== 'string' ||
    !ciphertext ||
    ciphertext.length > 8 * 1024 * 1024
  ) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'bundle_id and ciphertext are required (<=8MB)', data: {} });
    return;
  }
  const db = getDb();
  const membership = db
    .prepare("SELECT 1 AS x FROM team_members WHERE team_id = ? AND member_id = ? AND status = 'active'")
    .get(teamId, String(device_id ?? ''));
  if (!membership) {
    res.status(403).json({ code: 'FORBIDDEN', msg: 'device is not an active team member', data: {} });
    return;
  }
  const ts = typeof updated_at === 'number' && updated_at > 0 ? updated_at : Date.now();
  const existing = db
    .prepare('SELECT version AS v, updated_at AS u FROM team_bundles WHERE team_id = ? AND bundle_id = ?')
    .get(teamId, bundle_id) as { v: number; u: number } | undefined;

  let version: number;
  if (!existing) {
    version = 1;
    db.prepare(
      'INSERT INTO team_bundles (team_id, bundle_id, device_id, ciphertext, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(teamId, bundle_id, String(device_id ?? ''), ciphertext, version, ts);
  } else {
    // last-write-wins by updated_at; ties broken by higher version
    if (ts < existing.u || (ts === existing.u && (existing.v ?? 0) > 1)) {
      res.json({ code: 0, msg: 'stale write ignored', data: { version: existing.v, applied: false } });
      return;
    }
    version = existing.v + 1;
    db.prepare(
      'UPDATE team_bundles SET ciphertext = ?, device_id = ?, version = ?, updated_at = ? WHERE team_id = ? AND bundle_id = ?'
    ).run(ciphertext, String(device_id ?? ''), version, ts, teamId, bundle_id);
  }
  res.json({ code: 0, msg: 'success', data: { version, applied: true } });
});

app.get('/api/v1/teams/:id/bundles', requireAuth, (req: Request, res: Response) => {
  const teamId = String(req.params.id);
  const since = Number(req.query.since ?? 0);
  const db = getDb();
  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'team not found', data: {} });
    return;
  }
  const rows = (
    Number.isFinite(since) && since > 0
      ? db
          .prepare('SELECT * FROM team_bundles WHERE team_id = ? AND updated_at > ? ORDER BY updated_at DESC')
          .all(teamId, since)
      : db.prepare('SELECT * FROM team_bundles WHERE team_id = ? ORDER BY updated_at DESC').all(teamId)
  ) as Array<Record<string, unknown>>;
  res.json({
    code: 0,
    msg: 'success',
    data: {
      list: rows.map((row) => ({
        bundle_id: row.bundle_id,
        device_id: row.device_id,
        ciphertext: row.ciphertext,
        version: row.version,
        updated_at: row.updated_at,
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// Errors & startup
// ---------------------------------------------------------------------------

app.use((_req: Request, res: Response) => {
  res.status(404).json({ code: -1, msg: 'not found', data: {} });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[sync-server] error:', err);
  res.status(500).json({ code: -1, msg: 'internal error', data: {} });
});

initDb()
  .then(() => {
    ensureAuthSchema(getDb());
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[sync-server] listening on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err: unknown) => {
    console.error('[sync-server] failed to init DB:', err);
    process.exit(1);
  });