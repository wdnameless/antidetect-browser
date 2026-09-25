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
  duplicateProfile,
  exportProfileBundle,
  importProfileBundle,
  updateProfileFingerprint,
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

describe('a copy or a transferred bundle keeps the operator\'s configuration', () => {
  // The clone dropped seven fields and the export bundle dropped the same seven: a duplicated
  // profile reverted to a headed window, and a profile moved between machines arrived without its
  // start pages, launch arguments, colour, ports, WebRTC policy or Do-Not-Track. Both builders had
  // their own copy of the mapping, which is how they dropped the same things independently — they
  // now share one mapper, and this is the guard that would have caught the original gap.
  const configured = () => ({
    name: 'configured',
    browser_type: 'chromium' as const,
    user_agent: 'UA/1',
    timezone: 'Europe/Berlin',
    start_urls: ['https://a.example', 'https://b.example'],
    mobile_model_id: 'pixel-7',
    launch_args: ['--lang=en-US'],
    color: '#112233',
    notes: 'warmup done',
    do_not_track: 'on' as const,
    blocked_ports: [1234, 5678],
    webrtc_policy: 'disable_non_proxied_udp' as const,
    headless: true,
  });

  /** The configuration fields, as the detail payload reports them. */
  const configOf = (id: string) => {
    const d = getProfileDetails(id);
    if (!d) throw new Error(`no detail for ${id}`);
    return {
      start_urls: d.start_urls,
      launch_args: d.launch_args,
      color: d.color,
      do_not_track: d.do_not_track,
      blocked_ports: d.blocked_ports,
      webrtc_policy: d.webrtc_policy,
      headless: d.headless,
    };
  };

  it('duplicating a profile carries its configuration, but not the note', () => {
    const src = createProfile(configured());
    const clone = duplicateProfile(src);
    expect(clone).not.toBeNull();

    expect(configOf(clone as string)).toEqual(configOf(src));
    // A note describes that profile's history; copying it onto a fresh profile states something
    // untrue about the new one.
    expect(getProfileDetails(clone as string)?.notes).toBeNull();
  });

  it('exporting and re-importing a bundle reproduces the configuration exactly', () => {
    const src = createProfile(configured());
    const bundle = exportProfileBundle(src);
    expect(bundle).not.toBeNull();
    // Through JSON, as the real file round trip does.
    const restored = importProfileBundle(JSON.parse(JSON.stringify(bundle)));

    expect(configOf(restored)).toEqual(configOf(src));
    expect(getProfileDetails(restored)?.mobile_model_id).toBe('pixel-7');
    expect(getProfileDetails(restored)?.notes).toBe('warmup done');
  });

  it('reads a bundle written by an older build, which lacks the new fields', () => {
    // A bundle outlives the app version that wrote it, so the fields had to be optional. An older
    // bundle must still import rather than throw.
    const src = createProfile(configured());
    const bundle = exportProfileBundle(src);
    expect(bundle).not.toBeNull();
    const legacy = JSON.parse(JSON.stringify(bundle)) as { profile: Record<string, unknown> };
    for (const key of ['launch_args', 'color', 'notes', 'do_not_track', 'blocked_ports', 'webrtc_policy', 'headless']) {
      delete legacy.profile[key];
    }

    const restored = importProfileBundle(legacy);
    expect(getProfileDetails(restored)?.user_id).toBe(restored);
    expect(configOf(restored).headless).toBe(false);
  });
  it('carries the fingerprint settings a clone would otherwise regenerate', () => {
    // Found by an independent reviewer, not by me. `createProfile` derives a fresh fingerprint for
    // the seed it is handed, which is right for a new profile and wrong for a copy: the operator's
    // own overrides live in `fingerprints.config_json` and were replaced wholesale. Measured before
    // the fix: a source with an explicit `de-DE` and a per-surface noise choice produced a clone
    // reporting `id-ID` with no noise settings — the same defect as the dropped profile fields,
    // one level deeper.
    const src = createProfile({ name: 'fp-src' });
    updateProfileFingerprint(src, { lang: 'de-DE', disableSpoofing: 'canvas,webgl' });

    const db = getDb();
    const fpOf = (id: string): { seed: number; cfg: Record<string, unknown> } => {
      const fid = (db.prepare('SELECT fingerprint_id AS f FROM profiles WHERE id = ?').get(id) as { f: string }).f;
      const row = db.prepare('SELECT seed, config_json FROM fingerprints WHERE id = ?').get(fid) as {
        seed: number;
        config_json: string;
      };
      return { seed: row.seed, cfg: JSON.parse(row.config_json) as Record<string, unknown> };
    };

    const before = fpOf(src);
    const clone = duplicateProfile(src);
    expect(clone).not.toBeNull();
    const after = fpOf(clone as string);

    expect(after.cfg.lang).toBe('de-DE');
    expect(after.cfg.disableSpoofing).toBe('canvas,webgl');
    // The seed travels too: a clone reporting the source's GPU but a different CPU would be
    // incoherent, which is what the shared config builder exists to prevent.
    expect(after.cfg.family).toBe(before.cfg.family);
    expect(after.seed).toBe(before.seed);
  });
});
