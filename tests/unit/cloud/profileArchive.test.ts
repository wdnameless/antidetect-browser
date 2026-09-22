// The profile-directory archive: framing, exclusions, and the path-escape guard.
//
// Two things here are worth a test rather than a manual check.
//
// First, `frameFiles`/`unframeFiles` are the only thing standing between a Drive blob and the disk.
// The archive is downloaded from a cloud account the product treats as the operator's, but a
// tampered or truncated file must fail loudly instead of writing half of a profile — a partial
// `Local Storage` is indistinguishable from an empty one when the browser opens.
//
// Second, the exclusion policy is what keeps the tier honest. Measured on a real install the
// profile directories are 785 MB, of which 759.8 MB is regenerated cache and 1.75 MB is the site
// state that actually carries a login. If the cache list silently stops matching, the feature still
// "works" while moving a gigabyte per run — the kind of regression that only shows up as a quota
// bill, so it is pinned here.
import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { initDb } from '../../../src/main/db';
import { frameFiles, unframeFiles, buildProfileArchive } from '../../../src/main/cloud/profileArchive';

describe('site-state container', () => {
  beforeAll(async () => {
    // `buildProfileArchive` enumerates live profiles, which reads the database. The suite's setup
    // points ANTIDETECT_DATA_DIR at a temp sandbox, so this never touches real user data.
    await initDb();
  });
  it('round-trips paths and bytes exactly', () => {
    const entries = [
      { rel: 'p_a/Default/Local Storage/leveldb/CURRENT', data: Buffer.from('MANIFEST-000001\n') },
      { rel: 'p_a/Default/Network/Cookies', data: Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0xff]) },
      { rel: 'p_b/Default/Sessions/abc', data: Buffer.alloc(0) },
    ];
    const restored = unframeFiles(frameFiles(entries));
    expect(restored.map((e) => e.rel)).toEqual(entries.map((e) => e.rel));
    for (let i = 0; i < entries.length; i += 1) {
      expect(Buffer.compare(restored[i].data, entries[i].data), entries[i].rel).toBe(0);
    }
  });

  it('preserves non-UTF8 bytes, which cookie databases contain', () => {
    // A cookie's encrypted value is binary. A container that round-trips through a JS string would
    // corrupt it, and the failure would surface as "logged out on the other machine" — far from here.
    const binary = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const [entry] = unframeFiles(frameFiles([{ rel: 'p/Default/Network/Cookies', data: binary }]));
    expect(Buffer.compare(entry.data, binary)).toBe(0);
  });

  it('rejects a foreign or truncated blob instead of returning partial data', () => {
    expect(() => unframeFiles(Buffer.from('not an archive at all'))).toThrow();
    const good = frameFiles([{ rel: 'p/f', data: Buffer.from('hello world') }]);
    expect(() => unframeFiles(good.subarray(0, Math.floor(good.length / 2)))).toThrow();
  });
});

describe('exclusion policy', () => {
  // The exclusion assertions must run against a profile that ACTUALLY has caches on disk. Without
  // this fixture the archive is empty on a clean sandbox and every `for` loop below passes
  // vacuously — a guard that cannot fail, which is exactly what this file exists to avoid.
  let fixtureProfile = '';
  let fixtureDir = '';

  beforeAll(async () => {
    const { createProfile } = await import('../../../src/main/profiles/profileManager');
    const { resolveProfileDir } = await import('../../../src/main/io/cookieSqlite');
    const fs = await import('fs');

    fixtureProfile = createProfile({ name: 'archive-fixture' });
    fixtureDir = resolveProfileDir(fixtureProfile);

    // Regenerated caches that must never travel …
    for (const dir of ['Cache', 'Code Cache', 'Service Worker', 'GPUCache', 'DawnWebGPUCache']) {
      fs.mkdirSync(path.join(fixtureDir, 'Default', dir), { recursive: true });
      fs.writeFileSync(path.join(fixtureDir, 'Default', dir, 'blob.bin'), Buffer.alloc(4096, 7));
    }
    // … and site state that must.
    fs.mkdirSync(path.join(fixtureDir, 'Default', 'Local Storage', 'leveldb'), { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'Default', 'Local Storage', 'leveldb', 'CURRENT'), 'MANIFEST-000001\n');
    fs.mkdirSync(path.join(fixtureDir, 'Default', 'Network'), { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'Default', 'Network', 'Cookies'), Buffer.from([1, 2, 3]));
    // Locks and the machine-bound key, which must be refused even though they exist on disk.
    fs.writeFileSync(path.join(fixtureDir, 'lockfile'), '');
    fs.writeFileSync(path.join(fixtureDir, 'Local State'), '{"os_crypt":{"encrypted_key":"DPAPI...."}}');
    fs.writeFileSync(path.join(fixtureDir, 'Default', 'Cache', 'index'), 'x');
  });

  it('picks up the fixture profile, so the assertions below are not vacuous', () => {
    const built = buildProfileArchive([fixtureProfile], false);
    expect(unframeFiles(built.blob).length, 'fixture produced no files — this guard would pass empty').toBeGreaterThan(0);
  });

  it('keeps the archive free of regenerated caches', () => {
    const entries = unframeFiles(buildProfileArchive([fixtureProfile], false).blob);
    for (const e of entries) {
      for (const f of ['/Cache/', '/Code Cache/', '/Service Worker/', '/GPUCache/', '/DawnWebGPUCache/']) {
        expect(e.rel.includes(f), `regenerated cache leaked into the archive: ${e.rel}`).toBe(false);
      }
    }
    // And the site state really is in there — otherwise "no caches" would be satisfied by an empty
    // archive, which is the failure mode this whole file is about.
    const rels = entries.map((e) => e.rel).join('|');
    expect(rels).toContain('Local Storage');
    expect(rels).toContain('Network/Cookies');
  });

  it('never ships a lock or the machine-bound Local State', () => {
    for (const e of unframeFiles(buildProfileArchive([fixtureProfile], false).blob)) {
      const base = path.posix.basename(e.rel);
      expect(base, `lock shipped: ${e.rel}`).not.toBe('lockfile');
      expect(base.startsWith('Singleton'), `singleton lock shipped: ${e.rel}`).toBe(false);
      expect(base, `DPAPI-wrapped key shipped: ${e.rel}`).not.toBe('Local State');
      expect(e.rel.includes('/DevToolsActivePort'), `port shipped: ${e.rel}`).toBe(false);
    }
  });

  it('the small tier keeps site state and drops the rest', () => {
    const small = unframeFiles(buildProfileArchive([fixtureProfile], true).blob).map((e) => e.rel);
    expect(small.some((r) => r.includes('Local Storage'))).toBe(true);
    expect(small.some((r) => r.includes('Cache'))).toBe(false);
  });

  it('names the excluded paths instead of dropping them silently', () => {
    const built = buildProfileArchive([fixtureProfile], false);
    expect(built.excluded.length).toBeGreaterThan(0);
    expect(built.excluded.some((e) => e.includes('Cache'))).toBe(true);
    for (const e of built.excluded) {
      expect(e.startsWith('/')).toBe(false);
    }
  });
});
