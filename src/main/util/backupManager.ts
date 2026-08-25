// Backup listing and restore (v0.2.26). Backups are produced by the DB layer
// (daily, keep 5) in <DATA_DIR>/backups. Restore swaps the live DB file with a
// backup copy; the service must be restarted afterwards to reload it.
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, DB_PATH } from '../config';

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
 */
export function restoreBackup(name: string): void {
  if (!/^antidetect-[\w.-]+\.db$/.test(name)) throw new Error('invalid backup name');
  const src = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(src)) throw new Error('backup not found');
  if (src !== path.join(BACKUP_DIR, path.basename(name))) throw new Error('invalid backup name');

  // snapshot current state
  if (fs.existsSync(DB_PATH)) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `antidetect-pre-restore-${stamp}.db`));
  }
  const tmp = DB_PATH + '.restore-tmp';
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, DB_PATH);
}
