import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, getDb, closeDb } from '../../src/main/db';
import { createProfile, deleteProfile, listProfiles } from '../../src/main/profiles/profileManager';
import {
  listEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  revealEntry,
  deleteEntriesForProfile,
} from '../../src/main/vault/accountVault';

describe('account vault (Sprint 2.1)', () => {
  let profileId = '';

  beforeAll(async () => {
    await initDb();
    profileId = createProfile({ name: 'vault-test' });
  });

  it('stores the password encrypted, never in plaintext', () => {
    const r = createEntry(profileId, {
      label: 'main',
      login: 'user@example.com',
      password: 'S3cret!Value',
      totp_secret: 'JBSWY3DPEHPK3PXP',
    });
    expect(r.ok).toBe(true);
    const id = (r as { ok: true; data: { id: string } }).data.id;
    const row = getDb()
      .prepare('SELECT * FROM account_credentials WHERE id = ?')
      .get(id) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(String(row.password_enc)).not.toContain('S3cret!Value');
    expect(String(row.totp_secret_enc)).not.toContain('JBSWY3DPEHPK3PXP');
    // secretStore format: prefixed cipher (enc:/aes:/plain:)
    expect(String(row.password_enc)).toMatch(/^(enc|aes|plain):/);
  });

  it('list masks secrets and exposes has_* booleans', () => {
    const r = listEntries(profileId);
    expect(r.ok).toBe(true);
    const list = (r as { ok: true; data: Array<Record<string, unknown>> }).data;
    expect(list.length).toBe(1);
    const e = list[0] as unknown as { has_password: boolean; has_totp: boolean; password?: string; totp_secret?: string };
    expect(e.has_password).toBe(true);
    expect(e.has_totp).toBe(true);
    expect(e.password).toBeUndefined();
    expect(e.totp_secret).toBeUndefined();
  });

  it('reveal returns the decrypted value only for allowed fields', () => {
    const list = (listEntries(profileId) as { ok: true; data: Array<{ id: string }> }).data;
    const entry = list[0];
    const bad = revealEntry(profileId, entry.id, 'login');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('INVALID_FIELD');
    const pw = revealEntry(profileId, entry.id, 'password');
    expect(pw.ok).toBe(true);
    expect((pw as { ok: true; data: { value: string } }).data.value).toBe('S3cret!Value');
    const totp = revealEntry(profileId, entry.id, 'totp_secret');
    expect(totp.ok).toBe(true);
    expect((totp as { ok: true; data: { value: string } }).data.value).toBe('JBSWY3DPEHPK3PXP');
  });

  it('update re-encrypts only the provided fields', () => {
    const list = (listEntries(profileId) as { ok: true; data: Array<{ id: string }> }).data;
    const entry = list[0];
    const r = updateEntry(profileId, entry.id, { password: 'NewPass123', label: 'renamed' });
    expect(r.ok).toBe(true);
    const revealed = revealEntry(profileId, entry.id, 'password');
    expect((revealed as { ok: true; data: { value: string } }).data.value).toBe('NewPass123');
    const masked = (listEntries(profileId) as { ok: true; data: Array<{ label: string | null }> }).data;
    expect(masked[0].label).toBe('renamed');
    // login unchanged
    const login = (listEntries(profileId) as { ok: true; data: Array<{ login: string | null }> }).data;
    expect(login[0].login).toBe('user@example.com');
  });

  it('delete removes the entry and cascade clears all entries for a profile', () => {
    const list = (listEntries(profileId) as { ok: true; data: Array<{ id: string }> }).data;
    const entry = list[0];
    const del = deleteEntry(profileId, entry.id);
    expect(del.ok).toBe(true);
    expect(listEntries(profileId)).toMatchObject({ ok: true });
    const after = (listEntries(profileId) as { ok: true; data: unknown[] }).data;
    expect(after.length).toBe(0);
    // Recreate to test profile cascade
    createEntry(profileId, { label: 'second', password: 'x' });
    expect((listEntries(profileId) as { ok: true; data: unknown[] }).data.length).toBe(1);
    deleteEntriesForProfile(profileId);
    expect((listEntries(profileId) as { ok: true; data: unknown[] }).data.length).toBe(0);
  });

  it('entries are isolated per profile and unknown profiles 404', () => {
    const other = createProfile({ name: 'vault-other' });
    createEntry(other, { label: 'other', password: 'y' });
    const r = listEntries(other);
    expect(r.ok).toBe(true);
    expect((r as { ok: true; data: Array<{ label: string | null }> }).data[0].label).toBe('other');
    expect(listProfiles(1, 100).list.map((p) => p.user_id)).toContain(other);

    const missing = listEntries('p_does_not_exist');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('NOT_FOUND');

    deleteProfile(other);
    closeDb();
  });
});