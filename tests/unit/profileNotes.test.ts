// A per-profile note has to survive the trip to disk, or the Note surface is a lie.
//
// The reported request: «сделай в actions кнопку note (она даст возможность записывать какие
// то данные от профиля для юзера) И хранить их вместе с профилем, например я хочу туда
// записать свои данные от входа в аккаунт».
//
// The Edit modal already rendered a NOTES textarea, but there was no `notes` column on
// `profiles` and neither `createProfile` nor `updateProfile` carried the value — the operator
// typed, pressed Save, saw success, and the text was gone. That is the same class of defect as
// the silently dropped browser language (`profileLanguage.test.ts`), and it is worth a test at
// the storage seam rather than a source-text assertion: what matters is that the value read
// back equals the value written.
import { describe, it, expect, beforeAll } from 'vitest';
import { initDb } from '../../src/main/db';
import {
  createProfile,
  updateProfile,
  getProfileDetails,
  getProfile,
} from '../../src/main/profiles/profileManager';

describe('per-profile note persists', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('round-trips a note set at creation', () => {
    const id = createProfile({ name: 'notes-create', notes: 'main account: user@example.com' });
    expect(getProfileDetails(id)?.notes).toBe('main account: user@example.com');
  });

  it('round-trips a note written by an update', () => {
    // The edit path is the one the operator actually uses: the profile already exists.
    const id = createProfile({ name: 'notes-update' });
    expect(getProfileDetails(id)?.notes).toBeNull();

    expect(updateProfile(id, { notes: 'recovery code: 1234-5678' })).toBe(true);
    expect(getProfileDetails(id)?.notes).toBe('recovery code: 1234-5678');
  });

  it('clears the note when null is written', () => {
    const id = createProfile({ name: 'notes-clear', notes: 'temporary' });
    expect(updateProfile(id, { notes: null })).toBe(true);
    expect(getProfileDetails(id)?.notes).toBeNull();
  });

  it('stores whitespace-only and empty input as SQL NULL, not as a blank string', () => {
    // The UI sends whatever is in the textarea, including a field the operator emptied by
    // selecting-all and deleting. Persisting '   ' would make "has a note" true for a profile
    // the operator cleared, and the check would have to be duplicated at every call site.
    const id = createProfile({ name: 'notes-blank' });
    updateProfile(id, { notes: '   \n\t ' });
    expect(getProfile(id)?.notes).toBeNull();

    const created = createProfile({ name: 'notes-blank-create', notes: '  ' });
    expect(getProfile(created)?.notes).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    const id = createProfile({ name: 'notes-trim' });
    updateProfile(id, { notes: '  account: a@b.test  ' });
    expect(getProfileDetails(id)?.notes).toBe('account: a@b.test');
  });

  it('leaves the note untouched when an unrelated field is updated', () => {
    // A partial update must not blank the column: `updateProfile` is called with a single
    // field from several places, and an omitted key has to mean "leave it alone".
    const id = createProfile({ name: 'notes-preserved', notes: 'keep me' });
    updateProfile(id, { name: 'notes-preserved-renamed' });
    expect(getProfileDetails(id)?.notes).toBe('keep me');
  });
});
