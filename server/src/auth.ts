// Sync server auth: opaque bearer tokens persisted in SQLite.
// Sprint 1 keeps this simple and self-hostable — tokens are random 32-byte
// values bound to (team_id, device_id); no external auth provider.
import type { Request, Response, NextFunction } from 'express';
import { randomBytes, createHash } from 'crypto';
import { getDb } from './db';

export function ensureAuthSchema(db: { exec(sql: string): void }): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      team_id    TEXT NOT NULL,
      device_id  TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Issue a token for (team, device); returns the raw token ONCE. */
export function issueToken(teamId: string, deviceId: string): string {
  const token = randomBytes(32).toString('base64url');
  getDb()
    .prepare('INSERT INTO auth_tokens (token_hash, team_id, device_id, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), teamId, deviceId, Date.now());
  return token;
}

/** Express middleware: Authorization: Bearer <token>. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = String(req.headers.authorization ?? '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ code: 'UNAUTHORIZED', msg: 'missing bearer token', data: {} });
    return;
  }
  const row = getDb()
    .prepare('SELECT team_id, device_id FROM auth_tokens WHERE token_hash = ?')
    .get(hashToken(token)) as { team_id: string; device_id: string } | undefined;
  if (!row) {
    res.status(401).json({ code: 'UNAUTHORIZED', msg: 'invalid token', data: {} });
    return;
  }
  // team scoping: a token may only touch its own team
  const requested =
    typeof req.params.id === 'string' && req.params.id ? req.params.id : (req.body?.team_id as string | undefined);
  if (requested && requested !== row.team_id) {
    res.status(403).json({ code: 'FORBIDDEN', msg: 'token is bound to another team', data: {} });
    return;
  }
  (req as Request & { auth?: { team_id: string; device_id: string } }).auth = {
    team_id: row.team_id,
    device_id: row.device_id,
  };
  next();
}