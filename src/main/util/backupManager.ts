// Backup listing and restore (v0.2.26). Backups are produced by the DB layer
// (daily, keep 5) in <DATA_DIR>/backups. Restore swaps the live DB file with a
// backup copy; the service must be restarted afterwards to reload it.
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, DB_PATH } from '../config';
import { closeDb, flushDb, initDb } from '../db';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export interface BackupInfo {
  name: string;
  size: number;
  modified: number;
}

export function listBackups(): BackupInfo[] {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('antidetect-') && f.endsWith('.db'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, modified: st.mtimeMs };
      })
      .sort((a, b) => b.modified - a.modified);
  } catch {
    return [];
  }
}

/**
 * Restore a backup as the live database. Safety:
 *  - refuses unknown paths (name is validated upstream, re-checked here)
 *  - snapshots the CURRENT (possibly broken) DB before overwriting, so the
 *    operation itself is reversible
 *
 * RELOADS THE LIVE DATABASE. This function used to swap the file on disk and stop there,
 * which silently destroyed the restore: the live database is sql.js held IN MEMORY, so the
 * next ordinary write ran the debounced `persistNow()` and copied the stale in-memory state
 * back over the freshly restored file. Measured: with a backup holding STATE_A, the file read
 * STATE_A right after restore and STATE_C after one subsequent write.
 *
 * Returning `restart_required` was advice, and advice is not a guarantee — the Settings panel
 * that offers this operation tells the operator it is reversible, so it has to be.
 */
export async function restoreBackup(name: string): Promise<void> {
  if (!/^antidetect-[\w.-]+\.db$/.test(name)) throw new Error('invalid backup name');
  const src = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(src)) throw new Error('backup not found');
  if (src !== path.join(BACKUP_DIR, path.basename(name))) throw new Error('invalid backup name');

  // Stop the debounced flush from firing while the file is mid-swap: a pending write would
  // otherwise land on the restored file after we reload and overwrite it again.
  flushDb();

  // snapshot current state
  if (fs.existsSync(DB_PATH)) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `antidetect-pre-restore-${stamp}.db`));
  }
  const tmp = DB_PATH + '.restore-tmp';
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, DB_PATH);

  // Drop the in-memory instance and reopen from the restored file. Two things must NOT write
  // during this window, and both were writing before:
  //  - `Database.close()` persists by default, so it needs `{ persist: false }` here: the FILE
  //    is ahead of memory, and persisting would put the pre-restore state back.
  //  - a debounced flush armed by an earlier write would also land on the restored file; it is
  //    cancelled inside closeDb.
  closeDb({ persist: false });
  await initDb();
}
