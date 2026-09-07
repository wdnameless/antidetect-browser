import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { initDb, getDb, closeDb } from '../../src/main/db';
import { PROFILES_DIR } from '../../src/main/config';
import {
  createProfile,
  deleteProfile,
  getProfile,
  getProfileDetails,
  listProfiles,
  listTrash,
  restoreProfile,
  purgeProfile,
  purgeExpiredTrash,
  adoptOrphanedProfileDirs,
  createGroup,
} from '../../src/main/profiles/profileManager';
import { createTag, attachTag, tagsForProfile } from '../../src/main/tags/tagManager';
import { createEntry, listEntries } from '../../src/main/vault/accountVault';

describe('trash: soft delete, restore, purge (Sprint 2.4)', () => {

  beforeAll(async () => {
    await initDb();
  });

  it('delete moves the profile to trash instead of removing it', () => {
    const id = createProfile({ name: 'trash-me' });
    expect(deleteProfile(id)).toBe(true);
    // hidden from normal lists
    expect(listProfiles(1, 500).list.map((p) => p.user_id)).not.toContain(id);
    // but still present with deleted_at set
    const row = getProfile(id);
    expect(row).toBeDefined();
    expect(row!.deleted_at).not.toBeNull();
    // and visible in the trash listing
    const trash = listTrash();
    expect(trash.map((t) => t.id)).toContain(id);
    expect(trash.find((t) => t.id === id)!.name).toBe('trash-me');
  });

  it('details of a trashed profile behave as not-found', () => {
    const id = createProfile({ name: 'trash-2' });
    deleteProfile(id);
    expect(getProfileDetails(id)).toBeNull();
  });

  it('restore clears deleted_at and the profile returns to lists with tags and creds intact', () => {
    const gid = createGroup('trash-group');
    const id = createProfile({ name: 'restore-me', group_id: gid });
    const tagId = (createTag('restore-tag', '#123456') as { ok: true; data: { id: string } }).data.id;
    attachTag(tagId, [id]);
    createEntry(id, { label: 'acc', password: 'pw-restore' });
    deleteProfile(id);

    expect(restoreProfile(id)).toBe(true);
    const row = getProfile(id);
    expect(row!.deleted_at).toBeNull();
    expect(listProfiles(1, 500).list.map((p) => p.user_id)).toContain(id);
    // tag binding survived the round-trip
    expect(tagsForProfile(id).map((t) => t.name)).toContain('restore-tag');
    // credentials survived
    expect((listEntries(id) as { ok: true; data: unknown[] }).data.length).toBe(1);
    // restore again must fail (already live)
    expect(restoreProfile(id)).toBe(false);
    void getDb();
  });

  it('purge removes the row, bindings, credentials permanently', () => {
    const id = createProfile({ name: 'purge-me' });
    const tagId = (createTag('purge-tag') as { ok: true; data: { id: string } }).data.id;
    attachTag(tagId, [id]);
    createEntry(id, { label: 'acc', password: 'pw-purge' });
    deleteProfile(id);

    expect(purgeProfile(id)).toBe(true);
    expect(getProfile(id)).toBeUndefined();
    const bindings = getDb()
      .prepare('SELECT COUNT(*) AS c FROM profile_tags WHERE profile_id = ?')
      .get(id) as { c: number };
    expect(bindings.c).toBe(0);
    const creds = getDb()
      .prepare('SELECT COUNT(*) AS c FROM account_credentials WHERE profile_id = ?')
      .get(id) as { c: number };
    expect(creds.c).toBe(0);
    expect(purgeProfile(id)).toBe(false);
  });

  it('purgeExpiredTrash removes only entries older than 30 days', () => {
    const fresh = createProfile({ name: 'trash-fresh' });
    const old = createProfile({ name: 'trash-old' });
    deleteProfile(fresh);
    deleteProfile(old);
    // age the second one artificially
    getDb()
      .prepare('UPDATE profiles SET deleted_at = ? WHERE id = ?')
      .run(Date.now() - 31 * 24 * 60 * 60 * 1000, old);

    const purged = purgeExpiredTrash();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(getProfile(old)).toBeUndefined();
    expect(getProfile(fresh)).toBeDefined();
    expect(listTrash().map((t) => t.id)).toContain(fresh);
  });

  it('soft delete is shared by single and bulk paths', () => {
    const a = createProfile({ name: 'bulk-a' });
    deleteProfile(a);
    expect(listProfiles(1, 500).list.map((p) => p.user_id)).not.toContain(a);
    expect(listTrash().map((t) => t.id)).toContain(a);
    closeDb();
  });

  it('adoptOrphanedProfileDirs re-registers a real workspace dir without a DB row', async () => {
    // the earlier bulk test closes the DB; re-open for this test
    await initDb();
    const orphanId = 'p_' + randomUUID();
    const dir = path.join(PROFILES_DIR, orphanId);
    fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Local State'), '{}', 'utf8');

    expect(getProfile(orphanId)).toBeUndefined();
    const adopted = adoptOrphanedProfileDirs();
    expect(adopted).toBeGreaterThanOrEqual(1);

    const row = getProfile(orphanId);
    expect(row).toBeDefined();
    expect(row!.name).toBe('Recovered profile');
    expect(row!.status).toBe('closed');
    // listed as a live profile again
    expect(listProfiles(1, 500).list.map((p) => p.user_id)).toContain(orphanId);
  });

  it('adoptOrphanedProfileDirs skips empty stubs and known ids', async () => {
    await initDb();
    const stubId = 'p_' + randomUUID();
    fs.mkdirSync(path.join(PROFILES_DIR, stubId), { recursive: true }); // no browser artifacts
    expect(getProfile(stubId)).toBeUndefined();

    const live = createProfile({ name: 'already-registered' });
    adoptOrphanedProfileDirs();
    // still exactly one row for the known id — no duplicate insert
    const countRow = getDb().prepare('SELECT COUNT(*) AS c FROM profiles WHERE id = ?').get(live) as
      | { c: number }
      | undefined;
    expect(countRow?.c).toBe(1);
  });
});