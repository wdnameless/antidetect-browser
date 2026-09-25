// Three data-loss defects found in a release bug hunt, each destroying an operator's setting
// through an ordinary action. All three shared a shape worth naming: a field that is READ by a
// form but not returned by the API (so the form shows a default and writes it back), or a
// full-REPLACE writer fed a partial list.
//
// Each case below performs the user's action and asserts the value survives — not that some
// function was called.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, getDb } from '../../src/main/db';
import {
  createProfile,
  getProfileDetails,
  updateProfile,
  createGroup,
  updateGroup,
} from '../../src/main/profiles/profileManager';
import { bindExtensions, getProfileExtensionIds } from '../../src/main/extensions/extensionManager';

describe('a setting a form shows is a setting the API must return', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM profiles; DELETE FROM fingerprints; DELETE FROM groups; DELETE FROM profile_extensions;');
  });

  it('returns mobile_model_id from the detail endpoint, so editing cannot wipe it', () => {
    // The defect: `getProfileDetails` never sent this field. The Edit modal read `undefined`,
    // its Phone Model select fell back to "Auto", and Save sent `mobile_model_id: '' || null` —
    // so renaming a mobile profile destroyed the pinned device model. Measured before the fix:
    // created with 'pixel-7', null after a rename.
    const id = createProfile({ name: 'mobile', mobile_model_id: 'pixel-7' });

    const detail = getProfileDetails(id);
    expect(detail).not.toBeNull();
    // The field must be PRESENT, not merely truthy: the modal distinguishes "Auto" from a
    // concrete model by the value it receives, so an absent key is the defect.
    expect(detail && 'mobile_model_id' in detail).toBe(true);
    expect(detail?.mobile_model_id).toBe('pixel-7');
  });

  it('keeps the model across the edit round trip the modal performs', () => {
    const id = createProfile({ name: 'mobile', mobile_model_id: 'pixel-7' });
    const shownInForm = getProfileDetails(id)?.mobile_model_id ?? '';
    // Exactly what saveProfileModal sends in edit mode.
    updateProfile(id, { name: 'renamed', mobile_model_id: shownInForm || null });

    const row = getDb()
      .prepare('SELECT mobile_model_id AS m, name FROM profiles WHERE id = ?')
      .get(id) as { m: string | null; name: string };
    expect(row.name).toBe('renamed');
    expect(row.m, 'a rename must not destroy the pinned phone model').toBe('pixel-7');
  });

  it('preserves a group\'s bookmarks when the group is renamed', () => {
    // The defect: the rename form held `editBookmarks` (always `[]`, no editor exists) and passed
    // it straight to `updateGroup`, which writes any value that is not `undefined`. Renaming
    // therefore replaced the stored bookmarks with an empty array.
    const gid = createGroup('Rename-Me');
    const bookmarks = JSON.stringify([{ title: 'Site', url: 'https://example.com' }]);
    getDb().prepare('UPDATE groups SET bookmarks = ? WHERE id = ?').run(bookmarks, gid);

    // What the fixed handler sends: the name only, bookmarks left undefined.
    updateGroup(gid, 'Renamed', undefined);

    const row = getDb().prepare('SELECT name, bookmarks FROM groups WHERE id = ?').get(gid) as {
      name: string;
      bookmarks: string | null;
    };
    expect(row.name).toBe('Renamed');
    expect(row.bookmarks, 'renaming must not clear the group bookmarks').toBe(bookmarks);
  });

  it('keeps existing extensions when another is bound, because bind REPLACES the set', () => {
    // The defect: `bindExtensions` deletes every binding for the profile first, and the Extensions
    // page sent only the clicked id — so binding a second extension silently unbound the first.
    // The fix reads the current set and merges.
    const id = createProfile({ name: 'with-ext' });

    bindExtensions(id, ['ext_a']);
    // What the fixed handler sends.
    const current = getProfileExtensionIds(id);
    bindExtensions(id, Array.from(new Set([...current, 'ext_b'])));

    expect(getProfileExtensionIds(id).sort()).toEqual(['ext_a', 'ext_b']);
  });
});
