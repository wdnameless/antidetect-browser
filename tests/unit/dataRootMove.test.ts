import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  moveDataRoot,
  setRunningChecker,
  setFsSeam,
  cancelMove,
  getMoveStatus
} from '../../src/main/dataRoot/mover';
import { initDb, closeDb, getDb, flushDb } from '../../src/main/db';
import initSqlJsPkg from 'sql.js';
import { DB_PATH } from '../../src/main/config';
import { readSettings, setDataDir } from '../../src/main/config';



describe('Data Root Mover', () => {
  let tempBase: string;
  let sourceDir: string;
  let targetDir: string;
  const originalEnv = process.env.ANTIDETECT_DATA_DIR;

  /**
   * Syncs the physical DB image inside sourceDir with the module-level DB
   * (which lives in the real DATA_DIR because DATA_DIR is resolved at import
   * time, before the sandbox env override).
   */
  function syncDbToSource(): void {
    flushDb();
    closeDb();
    fs.copyFileSync(DB_PATH, path.join(sourceDir, 'antidetect.db'));
  }

  /**
   * Reads profile rows directly from a relocated DB image (initDb cannot be
   * re-pointed at runtime: DB_PATH is resolved at module import).
   */
  async function readRelocatedRows(dir: string): Promise<Array<{ id: string; path: string | null }>> {
    const SQL = await initSqlJsPkg();
    const dbPath = path.join(dir, 'antidetect.db');
    const sqlDb = new SQL.Database(fs.readFileSync(dbPath));
    try {
      const res = sqlDb.exec('SELECT id, path FROM profiles ORDER BY id');
      const rows: Array<{ id: string; path: string | null }> = [];
      if (res.length > 0) {
        for (const row of res[0].values) {
          rows.push({ id: String(row[0]), path: row[1] == null ? null : String(row[1]) });
        }
      }
      return rows;
    } finally {
      sqlDb.close();
    }
  }

  beforeEach(async () => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mover-test-'));
    sourceDir = path.join(tempBase, 'source');
    targetDir = path.join(tempBase, 'target');
    fs.mkdirSync(sourceDir, { recursive: true });

    process.env.ANTIDETECT_DATA_DIR = sourceDir;
    setRunningChecker(null);
    setFsSeam(null);

    // DATA_DIR is resolved at module import (before the env override exists),
    // so initDb lands in the real data dir. Place a physical DB image inside
    // sourceDir for the mover to relocate, then reopen the module-level DB.
    await initDb();
    flushDb();
    closeDb();
    fs.copyFileSync(DB_PATH, path.join(sourceDir, 'antidetect.db'));
    await initDb();
  });

  afterEach(() => {
    try {
      closeDb();
    } catch {}
    setRunningChecker(null);
    setFsSeam(null);

    if (originalEnv !== undefined) {
      process.env.ANTIDETECT_DATA_DIR = originalEnv;
    } else {
      delete process.env.ANTIDETECT_DATA_DIR;
    }

    try {
      fs.rmSync(tempBase, { recursive: true, force: true });
    } catch {}
  });

  it('1. refuse-when-running: refuses move if a profile is running', async () => {
    setRunningChecker(() => true);

    const res = await moveDataRoot(targetDir, { sourceDir });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/running/i);
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it('2. refuse concurrent moves: fails if move.lock already exists', async () => {
    const lockFile = path.join(sourceDir, 'move.lock');
    fs.writeFileSync(lockFile, '12345', 'utf8');

    const res = await moveDataRoot(targetDir, { sourceDir });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already in progress/i);
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it('3. happy path: copy-verify-swap succeeds, row count preserved, old root removed, setting updated', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO profiles (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('p1', 'Profile 1', path.join(sourceDir, 'profiles', 'p1'), Date.now(), Date.now());
    syncDbToSource();

    // Create extra dummy file in source
    fs.writeFileSync(path.join(sourceDir, 'sample.txt'), 'hello world', 'utf8');

    const progressPhases: string[] = [];
    const res = await moveDataRoot(targetDir, {
      sourceDir,
      onProgress: (p) => progressPhases.push(p.phase)
    });

    expect(res.ok).toBe(true);
    expect(progressPhases).toContain('copy');
    expect(progressPhases).toContain('verify');
    expect(progressPhases).toContain('swap');
    expect(progressPhases).toContain('done');

    // Target has files, old root removed
    expect(fs.existsSync(path.join(targetDir, 'sample.txt'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'antidetect.db'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, '.incomplete'))).toBe(false);
    expect(fs.existsSync(sourceDir)).toBe(false);

    // Persisted setting updated
    const settings = readSettings();
    expect(path.resolve(settings.dataDir as string).toLowerCase()).toBe(path.resolve(targetDir).toLowerCase());

    // DB at new root has preserved row count and rewritten path (direct read:
    // initDb cannot be re-pointed at runtime, DB_PATH is resolved at import).
    const rows = await readRelocatedRows(targetDir);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('p1');
    expect(rows[0].path).toBe(path.join(targetDir, 'profiles', 'p1'));
  });

  it('4. injected verify failure: aborts, old root intact, target marked incomplete', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO profiles (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('p-fail', 'Profile Fail', path.join(sourceDir, 'profiles', 'p-fail'), Date.now(), Date.now());
    syncDbToSource();

    fs.writeFileSync(path.join(sourceDir, 'test.txt'), 'original content', 'utf8');

    // Injected verify failure
    setFsSeam({
      copyFile: (s, d) => fs.copyFileSync(s, d),
      verifyFile: (_s, d) => {
        if (d.endsWith('test.txt')) return false;
        return true;
      }
    });

    const res = await moveDataRoot(targetDir, { sourceDir });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/verification failed/i);

    // Old root intact
    expect(fs.existsSync(sourceDir)).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, 'test.txt'))).toBe(true);

    // Target marked incomplete
    expect(fs.existsSync(path.join(targetDir, '.incomplete'))).toBe(true);
  });

  it('5. absolute-path rewrite: profile row old-root -> new-root, relative untouched', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO profiles (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('p-abs', 'Abs Profile', path.join(sourceDir, 'custom', 'path'), Date.now(), Date.now());

    db.prepare(`
      INSERT INTO profiles (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('p-rel', 'Rel Profile', 'relative/sub/path', Date.now(), Date.now());
    syncDbToSource();

    const res = await moveDataRoot(targetDir, { sourceDir });
    expect(res.ok).toBe(true);

    const rows = await readRelocatedRows(targetDir);

    const absRow = rows.find(r => r.id === 'p-abs');
    const relRow = rows.find(r => r.id === 'p-rel');

    expect(absRow?.path).toBe(path.join(targetDir, 'custom', 'path'));
    expect(relRow?.path).toBe('relative/sub/path');
  });

  it('6. cancel mid-copy: partial target cleaned, setting unchanged', async () => {
    // Write multiple files
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(sourceDir, `file${i}.txt`), `content ${i}`, 'utf8');
    }

    setFsSeam({
      copyFile: (s, d) => {
        fs.copyFileSync(s, d);
        if (s.endsWith('file2.txt')) {
          cancelMove();
        }
      }
    });

    const initialSettings = readSettings();

    const res = await moveDataRoot(targetDir, { sourceDir });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cancelled/i);

    // Old root intact
    expect(fs.existsSync(sourceDir)).toBe(true);
    // Partial target cleaned
    expect(fs.existsSync(targetDir)).toBe(false);

    // Setting unchanged
    const finalSettings = readSettings();
    expect(finalSettings.dataDir).toBe(initialSettings.dataDir);
  });
});
