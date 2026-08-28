// Global key/value store (Sprint 4.2): values encrypted at rest through the
// machine-local secret store (AES-256-GCM / DPAPI in Electron).
// List responses expose NAMES only; plaintext goes through a dedicated reveal
// endpoint and into worker memory for scripts — never into logs.
import { getDb } from '../db';
import { protectSecret, revealSecret } from '../util/secretStore';

export interface KeyItem {
  key: string;
  has_value: boolean;
  updated_at: number;
}

export type KeyResult<T> = { ok: true; data: T } | { ok: false; code: string; msg: string };

const KEY_NAME_RE = /^[a-zA-Z0-9_.-]{1,128}$/;

export function listKeys(): KeyItem[] {
  const rows = getDb()
    .prepare('SELECT key, value_enc, updated_at FROM global_keys ORDER BY key ASC')
    .all() as Array<{ key: string; value_enc: string; updated_at: number }>;
  return rows.map((r) => ({ key: r.key, has_value: Boolean(r.value_enc), updated_at: r.updated_at }));
}

export function setKeyValue(key: string, value: string): KeyResult<{ key: string }> {
  if (!KEY_NAME_RE.test(key)) {
    return { ok: false, code: 'INVALID_INPUT', msg: 'key must match [a-zA-Z0-9_.-]{1,128}' };
  }
  const enc = protectSecret(value);
  if (!enc) return { ok: false, code: 'INVALID_INPUT', msg: 'value must not be empty' };
  getDb()
    .prepare(
      `INSERT INTO global_keys (key, value_enc, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`
    )
    .run(key, enc, Date.now());
  return { ok: true, data: { key } };
}

export function deleteKey(key: string): KeyResult<{ deleted: boolean }> {
  const res = getDb().prepare('DELETE FROM global_keys WHERE key = ?').run(key);
  if (res.changes === 0) return { ok: false, code: 'NOT_FOUND', msg: 'key not found' };
  return { ok: true, data: { deleted: true } };
}

/** Plaintext for the reveal endpoint and for app.keys.get inside workers. */
export function revealKeyValue(key: string): KeyResult<{ value: string }> {
  const row = getDb().prepare('SELECT value_enc FROM global_keys WHERE key = ?').get(key) as
    | { value_enc: string }
    | undefined;
  if (!row) return { ok: false, code: 'NOT_FOUND', msg: 'key not found' };
  const value = revealSecret(row.value_enc);
  if (value === undefined) return { ok: false, code: 'NOT_FOUND', msg: 'value unreadable' };
  return { ok: true, data: { value } };
}

/** Worker-side read (same as revealKeyValue, separate name for intent). */
export function getKeyValueForScript(key: string): string | undefined {
  const r = revealKeyValue(key);
  return r.ok ? r.data.value : undefined;
}