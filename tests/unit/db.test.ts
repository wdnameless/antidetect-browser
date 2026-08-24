import { describe, it, expect } from 'vitest';
import { initDb, getDb, closeDb, flushDb } from '../../src/main/db';
import { DB_PATH, DATA_DIR } from '../../src/main/config';
import * as fs from 'fs';
import * as path from 'path';

describe('database layer', () => {
  it('initializes, migrates and persists atomically (no .tmp left behind)', async () => {
    await initDb();
    const db = getDb();
    db.prepare(
      "INSERT INTO groups (id, name, created_at) VALUES ('g_test1', 'Test Group', ?)"
    ).run(Date.now());

    flushDb();

    expect(fs.existsSync(DB_PATH)).toBe(true);
    expect(fs.existsSync(DB_PATH + '.tmp')).toBe(false);
  });

  it('data survives close + reopen (persistence works)', async () => {
    closeDb();
    await initDb();
    const row = getDb().prepare("SELECT name FROM groups WHERE id = 'g_test1'").get() as
      | { name: string }
      | undefined;
    expect(row?.name).toBe('Test Group');
  });

  it('migrations are idempotent (initDb twice is safe) and mobile_model_id exists', async () => {
    closeDb();
    await initDb(); // second init over the same file
    const cols = getDb().prepare('PRAGMA table_info(profiles)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'mobile_model_id')).toBe(true);
    expect(cols.some((c) => c.name === 'browser_type')).toBe(true);
  });

  it('creates a daily backup on startup when none exists yet', async () => {
    closeDb();
    // remove backup stamp so initDb makes a fresh backup
    const stamp = path.join(DATA_DIR, 'backups', '.last-backup');
    if (fs.existsSync(stamp)) fs.rmSync(stamp);
    await initDb();
    const backups = fs
      .readdirSync(path.join(DATA_DIR, 'backups'))
      .filter((f) => f.startsWith('antidetect-') && f.endsWith('.db'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('debounced persist flushes within the debounce window', async () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO groups (id, name, created_at) VALUES ('g_test2', 'Debounce Group', ?)"
    ).run(Date.now());
    // wait > 100ms debounce without explicit flush
    await new Promise((r) => setTimeout(r, 400));
    closeDb();
    await initDb();
    const row = getDb().prepare("SELECT name FROM groups WHERE id = 'g_test2'").get() as
      | { name: string }
      | undefined;
    expect(row?.name).toBe('Debounce Group');
    closeDb();
  });
});
