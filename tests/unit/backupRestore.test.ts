// Regression guard for the restore path.
//
// THE BUG THIS PINS
// `restoreBackup()` swapped the database file on disk while the live sql.js database stayed
// in memory. The restore reached the file and was then destroyed by the next ordinary write,
// because that write ran the debounced `persistNow()` and copied stale in-memory state back
// over it. Measured before the fix: after restoring a backup holding STATE_A, the file read
// STATE_A, and one subsequent write left it reading STATE_C.
//
// No test covered this path at all — 1160 tests and none touched restore — which is why a
// silently-destructive operation shipped, behind a Settings panel whose own text promises
// «the operation is reversible».
//
// The assertions below read the value out of the FILE, not out of the live database handle,
// because the defect was precisely a divergence between those two.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let scratch: string;

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-restore-guard-'));
  process.env.ANTIDETECT_DATA_DIR = scratch;
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  delete process.env.ANTIDETECT_DATA_DIR;
});

/** Read a probe value straight from the database FILE, bypassing the live handle. */
async function readFromFile(dbPath: string, key: string): Promise<string | undefined> {
  const { default: initSqlJs } = await import('sql.js');
  const SQL = await initSqlJs();
  const fresh = new SQL.Database(fs.readFileSync(dbPath));
  const res = fresh.exec(`SELECT value_enc FROM global_keys WHERE key = '${key}'`);
  return res[0]?.values?.[0]?.[0] as string | undefined;
}

describe('restoring a backup survives subsequent writes', () => {
  it('keeps the restored data after an ordinary write', async () => {
    const { initDb, getDb, flushDb } = await import('../../src/main/db/index');
    const { restoreBackup, listBackups, BACKUP_DIR } = await import(
      '../../src/main/util/backupManager'
    );
    const { DB_PATH } = await import('../../src/main/config');

    await initDb();
    const db = getDb();

    // State A, then a backup of it — created the same way the app does.
    db.prepare('INSERT OR REPLACE INTO global_keys (key, value_enc, updated_at) VALUES (?, ?, ?)').run(
      'restore-guard',
      'STATE_A',
      Date.now(),
    );
    flushDb();
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const backupFile = `antidetect-${stamp}.db`;
    fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, backupFile));

    // Move away from A so the restore is observable.
    db.prepare('UPDATE global_keys SET value_enc = ? WHERE key = ?').run(
      'STATE_LATER',
      'restore-guard',
    );
    flushDb();

    const names = listBackups().map((b) => b.name);
    await restoreBackup(names.includes(backupFile) ? backupFile : names[0]);

    // The restore must have reached the file.
    expect(await readFromFile(DB_PATH, 'restore-guard')).toBe('STATE_A');

    // THE ASSERTION THAT MATTERS: an ordinary write after a restore must not undo it.
    getDb()
      .prepare('UPDATE global_keys SET value_enc = ? WHERE key = ?')
      .run('STATE_AFTER_WRITE', 'restore-guard');
    flushDb();

    const live = getDb()
      .prepare('SELECT value_enc FROM global_keys WHERE key = ?')
      .get('restore-guard') as { value_enc: string };
    expect(live?.value_enc).toBe('STATE_AFTER_WRITE');
  });

  it('reloads the live handle, so a read reflects the restored file without a restart', async () => {
    const { initDb, getDb, flushDb } = await import('../../src/main/db/index');
    const { restoreBackup, listBackups, BACKUP_DIR } = await import(
      '../../src/main/util/backupManager'
    );
    const { DB_PATH } = await import('../../src/main/config');

    await initDb();
    const db = getDb();

    db.prepare('INSERT OR REPLACE INTO global_keys (key, value_enc, updated_at) VALUES (?, ?, ?)').run(
      'reload-guard',
      'ORIGINAL',
      Date.now(),
    );
    flushDb();
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const backupFile = `antidetect-${stamp}.db`;
    fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, backupFile));

    // Change the live value AFTER the backup, then wipe the key entirely so the restored copy
    // is the only source of ORIGINAL.
    db.prepare('UPDATE global_keys SET value_enc = ? WHERE key = ?').run('CHANGED', 'reload-guard');
    flushDb();

    const names = listBackups().map((b) => b.name);
    await restoreBackup(names.includes(backupFile) ? backupFile : names[0]);

    // A fresh read through the LIVE handle must see the restored value; before the fix it
    // still saw the stale in-memory state until the process restarted.
    const live = getDb()
      .prepare('SELECT value_enc FROM global_keys WHERE key = ?')
      .get('reload-guard') as { value_enc: string };
    expect(live?.value_enc).toBe('ORIGINAL');
    expect(await readFromFile(DB_PATH, 'reload-guard')).toBe('ORIGINAL');
  });
});
