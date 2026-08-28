// Account Vault (Sprint 2.1): per-profile credentials encrypted at rest.
//
// Passwords and TOTP secrets go through util/secretStore (AES-256-GCM with a
// machine-local key file, or DPAPI inside Electron). Plaintext is never written
// to the DB; list responses mask secrets — reveal is a separate endpoint.
import { randomUUID } from 'crypto';
import { getDb } from '../db';
import { protectSecret, revealSecret } from '../util/secretStore';

export interface VaultEntryInput {
  label?: string;
  login?: string;
  password?: string;
  totp_secret?: string;
  notes?: string;
}

export interface VaultEntryMasked {
  id: string;
  profile_id: string;
  label: string | null;
  login: string | null;
  has_password: boolean;
  has_totp: boolean;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export type VaultResult<T> = { ok: true; data: T } | { ok: false; code: string; msg: string };

const MASK = '******';

function toMasked(row: Record<string, unknown>): VaultEntryMasked {
  return {
    id: String(row.id),
    profile_id: String(row.profile_id),
    label: (row.label as string | null) ?? null,
    login: (row.login as string | null) ?? null,
    has_password: Boolean(row.password_enc),
    has_totp: Boolean(row.totp_secret_enc),
    notes: (row.notes as string | null) ?? null,
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
  };
}

function rowExists(db: ReturnType<typeof getDb>, profileId: string): boolean {
  const p = db.prepare('SELECT id FROM profiles WHERE id = ? AND deleted_at IS NULL').get(profileId);
  return p !== undefined;
}

export function listEntries(profileId: string): VaultResult<VaultEntryMasked[]> {
  const db = getDb();
  if (!rowExists(db, profileId)) return { ok: false, code: 'NOT_FOUND', msg: 'profile not found' };
  const rows = db
    .prepare('SELECT * FROM account_credentials WHERE profile_id = ? ORDER BY created_at ASC')
    .all(profileId) as Array<Record<string, unknown>>;
  return { ok: true, data: rows.map(toMasked) };
}

export function createEntry(profileId: string, input: VaultEntryInput): VaultResult<{ id: string }> {
  const db = getDb();
  if (!rowExists(db, profileId)) return { ok: false, code: 'NOT_FOUND', msg: 'profile not found' };
  const id = 'ac_' + randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO account_credentials (id, profile_id, label, login, password_enc, totp_secret_enc, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    profileId,
    input.label ?? null,
    input.login ?? null,
    protectSecret(input.password),
    protectSecret(input.totp_secret),
    input.notes ?? null,
    now,
    now
  );
  return { ok: true, data: { id } };
}

export function updateEntry(
  profileId: string,
  entryId: string,
  input: VaultEntryInput
): VaultResult<{ id: string }> {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM account_credentials WHERE id = ? AND profile_id = ?')
    .get(entryId, profileId) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, code: 'NOT_FOUND', msg: 'entry not found' };

  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.label !== undefined) { sets.push('label = ?'); params.push(input.label); }
  if (input.login !== undefined) { sets.push('login = ?'); params.push(input.login); }
  if (input.notes !== undefined) { sets.push('notes = ?'); params.push(input.notes); }
  if (input.password !== undefined) { sets.push('password_enc = ?'); params.push(protectSecret(input.password)); }
  if (input.totp_secret !== undefined) { sets.push('totp_secret_enc = ?'); params.push(protectSecret(input.totp_secret)); }
  if (sets.length === 0) return { ok: true, data: { id: entryId } };
  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(entryId);
  db.prepare(`UPDATE account_credentials SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return { ok: true, data: { id: entryId } };
}

export function deleteEntry(profileId: string, entryId: string): VaultResult<{ deleted: boolean }> {
  const db = getDb();
  const res = db
    .prepare('DELETE FROM account_credentials WHERE id = ? AND profile_id = ?')
    .run(entryId, profileId);
  if (res.changes === 0) return { ok: false, code: 'NOT_FOUND', msg: 'entry not found' };
  return { ok: true, data: { deleted: true } };
}

/** Allowed reveal fields: everything else is rejected (no arbitrary column read). */
const REVEALABLE_FIELDS = new Set(['password', 'totp_secret']);

export function revealEntry(
  profileId: string,
  entryId: string,
  field: string
): VaultResult<{ value?: string }> {
  if (!REVEALABLE_FIELDS.has(field)) {
    return { ok: false, code: 'INVALID_FIELD', msg: 'field must be password or totp_secret' };
  }
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM account_credentials WHERE id = ? AND profile_id = ?')
    .get(entryId, profileId) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, code: 'NOT_FOUND', msg: 'entry not found' };
  const stored = field === 'password' ? row.password_enc : row.totp_secret_enc;
  const value = revealSecret(stored as string | null);
  if (value === undefined) return { ok: false, code: 'NOT_FOUND', msg: 'secret not set' };
  return { ok: true, data: { value } };
}

/** Cascade used by the trash "delete forever" path. */
export function deleteEntriesForProfile(profileId: string): void {
  getDb().prepare('DELETE FROM account_credentials WHERE profile_id = ?').run(profileId);
}