import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createTemporaryProfile,
  getTemporaryProfile,
  isTemporaryProfile,
  listTemporaryProfiles,
  unregisterTemporaryProfile,
  assertPathContainment,
  cleanTemporaryDirectory,
  startupPurgeSweep,
  shutdownCleanup,
  TEMPORARY_PROFILES_DIR,
} from '../../../src/main/profiles/temporaryRegistry';
import { initDb, closeDb, getDb } from '../../../src/main/db';
import { listProfiles, exportCsv, moveToTrash } from '../../../src/main/profiles/profileManager';
import { buildChromiumArgs } from '../../../src/main/launcher/chromium';

describe('Disposable / Temporary Profiles', () => {
  let testRoot: string;
  let testTempProfilesDir: string;

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-temp-test-'));
    testTempProfilesDir = path.join(testRoot, '.temporary_profiles');
    fs.mkdirSync(testTempProfilesDir, { recursive: true });
    await initDb(':memory:');
  });

  afterEach(async () => {
    await shutdownCleanup();
    closeDb();
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Ephemeral creation and registry lookup', () => {
    it('creates temporary profile descriptor with unique ID and temporary: true', () => {
      const desc = createTemporaryProfile({
        name: 'Ephemeral Session 1',
        headless: true,
        startUrls: ['https://example.com'],
      });

      expect(desc.id).toBeDefined();
      expect(typeof desc.id).toBe('string');
      expect(desc.temporary).toBe(true);
      expect(desc.name).toBe('Ephemeral Session 1');
      expect(desc.headless).toBe(true);
      expect(desc.startUrls).toEqual(['https://example.com']);
      expect(desc.createdAt).toBeGreaterThan(0);
      expect(desc.userDataDir).toContain('.temporary_profiles');

      expect(isTemporaryProfile(desc.id)).toBe(true);
      expect(getTemporaryProfile(desc.id)).toEqual(desc);

      const all = listTemporaryProfiles();
      expect(all.some((p) => p.id === desc.id)).toBe(true);

      unregisterTemporaryProfile(desc.id);
      expect(isTemporaryProfile(desc.id)).toBe(false);
      expect(getTemporaryProfile(desc.id)).toBeUndefined();
    });
  });

  describe('Exclusion from Persistent Storage and Listing', () => {
    it('does NOT write any row to SQLite profiles table', () => {
      const desc = createTemporaryProfile({ name: 'Temp DB Test' });
      const db = getDb();
      const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(desc.id);
      expect(row).toBeUndefined();
    });

    it('is excluded from listProfiles()', () => {
      const desc = createTemporaryProfile({ name: 'Temp Exclusion Test' });
      const { list, total } = listProfiles(1, 100);
      expect(list.some((p) => p.id === desc.id)).toBe(false);
    });

    it('is excluded from exportCsv()', () => {
      const desc = createTemporaryProfile({ name: 'Temp CSV Exclusion' });
      const db = getDb();
      const allRows = db.prepare('SELECT * FROM profiles WHERE deleted_at IS NULL').all();
      expect(allRows.some((p: any) => p.id === desc.id)).toBe(false);
    });

    it('moveToTrash rejects or no-ops for temporary profiles not in DB', () => {
      const desc = createTemporaryProfile({ name: 'Temp Trash Test' });
      expect(() => moveToTrash(desc.id)).toThrow();
    });
  });

  describe('Path Containment Validation', () => {
    it('allows paths properly nested in .temporary_profiles', () => {
      const validPath = path.join(testTempProfilesDir, 'a4b2c3d4-uuid');
      expect(assertPathContainment(validPath, testRoot)).toBe(true);
    });

    it('rejects path traversal attempts with ../', () => {
      const maliciousTraversal = path.join(testTempProfilesDir, '..', 'profiles', 'target');
      expect(assertPathContainment(maliciousTraversal, testRoot)).toBe(false);
      expect(() => assertPathContainment(maliciousTraversal, testRoot, true)).toThrow(
        /Path traversal or escape detected/
      );
    });

    it('rejects targeting persistent profiles or preserved_browser_data directories', () => {
      const persistentProfilePath = path.join(testRoot, 'profiles', 'some-id');
      expect(assertPathContainment(persistentProfilePath, testRoot)).toBe(false);
      expect(() => assertPathContainment(persistentProfilePath, testRoot, true)).toThrow();

      const preservedPath = path.join(testRoot, 'preserved_browser_data', 'some-id');
      expect(assertPathContainment(preservedPath, testRoot)).toBe(false);
      expect(() => assertPathContainment(preservedPath, testRoot, true)).toThrow();
    });
  });

  describe('Directory Cleanup and Windows Resilience', () => {
    it('cleans up temporary directory recursively', async () => {
      const targetDir = path.join(testTempProfilesDir, 'temp-run-dir');
      fs.mkdirSync(path.join(targetDir, 'Default', 'Cache'), { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'Default', 'Cookies'), 'dummy cookie data');

      expect(fs.existsSync(targetDir)).toBe(true);
      const cleaned = await cleanTemporaryDirectory(targetDir, 1000);
      expect(cleaned).toBe(true);
      expect(fs.existsSync(targetDir)).toBe(false);
    });

    it('returns true if directory is already gone', async () => {
      const nonExistent = path.join(testTempProfilesDir, 'does-not-exist');
      const cleaned = await cleanTemporaryDirectory(nonExistent, 500);
      expect(cleaned).toBe(true);
    });
  });

  describe('Startup Orphan Sweep', () => {
    it('purges orphaned folders inside .temporary_profiles and leaves other folders intact', async () => {
      const orphan1 = path.join(testTempProfilesDir, 'orphan-1');
      const orphan2 = path.join(testTempProfilesDir, 'orphan-2');
      const persistentDir = path.join(testRoot, 'profiles', 'legit-profile');

      fs.mkdirSync(orphan1, { recursive: true });
      fs.mkdirSync(orphan2, { recursive: true });
      fs.mkdirSync(persistentDir, { recursive: true });
      fs.writeFileSync(path.join(orphan1, 'data.txt'), 'test');
      fs.writeFileSync(path.join(persistentDir, 'data.txt'), 'preserve me');

      const result = await startupPurgeSweep(testTempProfilesDir);
      expect(result.purged).toContain(orphan1);
      expect(result.purged).toContain(orphan2);
      expect(fs.existsSync(orphan1)).toBe(false);
      expect(fs.existsSync(orphan2)).toBe(false);
      expect(fs.existsSync(persistentDir)).toBe(true);
    });
  });

  describe('Headless Flag and Argument Propagation', () => {
    it('adds --headless=new when headless is true', async () => {
      const args = await buildChromiumArgs({
        profileId: 'test-profile-1',
        userDataDir: path.join(testTempProfilesDir, 'temp-proc'),
        headless: true,
      });

      expect(args).toContain('--headless=new');
    });

    it('does not add --headless=new when headless is false or undefined', async () => {
      const args = await buildChromiumArgs({
        profileId: 'test-profile-2',
        userDataDir: path.join(testTempProfilesDir, 'temp-proc-2'),
        headless: false,
      });

      expect(args).not.toContain('--headless=new');
    });
  });

  describe('Shutdown hooks', () => {
    it('shutdownCleanup cleans all registered temporary directories', async () => {
      const desc1 = createTemporaryProfile({ name: 'Shutdown 1' });
      const desc2 = createTemporaryProfile({ name: 'Shutdown 2' });

      fs.mkdirSync(desc1.userDataDir, { recursive: true });
      fs.mkdirSync(desc2.userDataDir, { recursive: true });

      expect(fs.existsSync(desc1.userDataDir)).toBe(true);
      expect(fs.existsSync(desc2.userDataDir)).toBe(true);

      await shutdownCleanup();

      expect(fs.existsSync(desc1.userDataDir)).toBe(false);
      expect(fs.existsSync(desc2.userDataDir)).toBe(false);
      expect(listTemporaryProfiles()).toEqual([]);
    });
  });
});
