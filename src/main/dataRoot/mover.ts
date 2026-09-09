import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, setDataDir } from '../config';
import { getDb, closeDb, initDb, flushDb } from '../db';
import { isRunning } from '../launcher/chromium';
import { startupPurgeSweep } from '../profiles/temporaryRegistry';
// sql.js UMD import is exposed via the db module (getSqlModule is internal);
// here we use the WASM module lazily through a local import to avoid a UMD global.
import initSqlJsPkg from 'sql.js';



export type MovePhase = 'idle' | 'copy' | 'verify' | 'swap' | 'done' | 'error';

export interface MoveProgress {
  phase: MovePhase;
  copied: number;
  total: number;
  bytesCopied: number;
  currentFile?: string;
  error?: string;
}

export interface MoveStatus {
  inProgress: boolean;
  phase: MovePhase;
  copied: number;
  total: number;
  bytesCopied: number;
  currentFile?: string;
  error?: string;
  sourceDir?: string;
  targetDir?: string;
}

export interface MoverFsSeam {
  copyFile: (src: string, dest: string) => Promise<void> | void;
  verifyFile?: (src: string, dest: string) => boolean | Promise<boolean>;
}

// Global active move state
let activeMoveStatus: MoveStatus = {
  inProgress: false,
  phase: 'idle',
  copied: 0,
  total: 0,
  bytesCopied: 0
};

let cancelRequested = false;

// Injectable running checker seam (for tests)
type RunningChecker = (profileId: string) => boolean;
let runningCheckerSeam: RunningChecker | null = null;

export function setRunningChecker(fn: RunningChecker | null): void {
  runningCheckerSeam = fn;
}

// Injectable fs seam (for tests)
let fsSeam: MoverFsSeam | null = null;

export function setFsSeam(seam: MoverFsSeam | null): void {
  fsSeam = seam;
}

export function getMoveStatus(): MoveStatus {
  return { ...activeMoveStatus };
}

export function cancelMove(): boolean {
  if (!activeMoveStatus.inProgress) return false;
  cancelRequested = true;
  return true;
}

/** Check if any profile is running */
export function anyProfileRunning(): boolean {
  if (runningCheckerSeam) {
    // If running checker is injected, test common profile IDs or a dummy check
    return runningCheckerSeam('__any__');
  }
  // Try checking from DB profiles if DB is initialized
  try {
    const db = getDb();
    const rows = db.prepare('SELECT id FROM profiles').all() as Array<{ id: string }>;
    for (const r of rows) {
      if (isRunning(r.id)) return true;
    }
  } catch {
    // If no db, rely on isRunning
  }
  return false;
}

const EXCLUDED_FILES = new Set(['service.lock', 'move.lock']);

function isExcluded(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  const base = path.basename(norm);
  if (EXCLUDED_FILES.has(base)) return true;
  if (base.endsWith('-wal') || base.endsWith('-shm')) return true;
  if (norm === '.temporary_profiles' || norm.startsWith('.temporary_profiles/')) return true;
  return false;
}

/** Pre-count all eligible files in the source directory, separating SQLite DB */
function collectFiles(
  dir: string,
  baseDir: string = dir
): { regularFiles: string[]; dbFiles: string[] } {
  let regularFiles: string[] = [];
  let dbFiles: string[] = [];

  if (!fs.existsSync(dir)) return { regularFiles, dbFiles };

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(baseDir, fullPath);
    if (isExcluded(rel)) continue;

    if (entry.isDirectory()) {
      const nested = collectFiles(fullPath, baseDir);
      regularFiles = regularFiles.concat(nested.regularFiles);
      dbFiles = dbFiles.concat(nested.dbFiles);
    } else if (entry.isFile()) {
      if (entry.name === 'antidetect.db') {
        dbFiles.push(fullPath);
      } else {
        regularFiles.push(fullPath);
      }
    }
  }

  return { regularFiles, dbFiles };
}

function verifySqliteHeader(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('latin1') === 'SQLite format 3\0';
  } catch {
    return false;
  }
}

/**
 * Executes moving data root from sourceDir (or DATA_DIR) to targetDir.
 */
export async function moveDataRoot(
  targetDir: string,
  options?: {
    sourceDir?: string;
    onProgress?: (p: MoveProgress) => void;
  }
): Promise<{ ok: boolean; error?: string }> {
  const sourceDir = path.resolve(options?.sourceDir || DATA_DIR);
  const resolvedTarget = path.resolve(targetDir);

  if (sourceDir.toLowerCase() === resolvedTarget.toLowerCase()) {
    return { ok: false, error: 'Target directory is the same as source directory' };
  }

  // 1. Gate: Refuse if running
  if (anyProfileRunning()) {
    const err = 'Cannot move data root while profiles are running';
    return { ok: false, error: err };
  }

  // 2. Gate: Refuse concurrent moves via move.lock
  const sourceLock = path.join(sourceDir, 'move.lock');
  if (fs.existsSync(sourceLock) || activeMoveStatus.inProgress) {
    return { ok: false, error: 'A data root move is already in progress' };
  }

  // Sweep .temporary_profiles first
  try {
    await startupPurgeSweep(sourceDir);
  } catch {
    // Ignore sweep failure
  }

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(sourceLock, String(process.pid), 'utf8');

  // Mark target incomplete
  fs.mkdirSync(resolvedTarget, { recursive: true });
  const incompleteMarker = path.join(resolvedTarget, '.incomplete');
  fs.writeFileSync(incompleteMarker, 'move-in-progress', 'utf8');

  cancelRequested = false;
  activeMoveStatus = {
    inProgress: true,
    phase: 'copy',
    copied: 0,
    total: 0,
    bytesCopied: 0,
    sourceDir,
    targetDir: resolvedTarget
  };

  const updateProgress = (p: Partial<MoveProgress>) => {
    activeMoveStatus = { ...activeMoveStatus, ...p };
    options?.onProgress?.({
      phase: activeMoveStatus.phase,
      copied: activeMoveStatus.copied,
      total: activeMoveStatus.total,
      bytesCopied: activeMoveStatus.bytesCopied,
      currentFile: activeMoveStatus.currentFile,
      error: activeMoveStatus.error
    });
  };

  try {
    // Pre-count files
    const { regularFiles, dbFiles } = collectFiles(sourceDir);
    const allFiles = [...regularFiles, ...dbFiles];
    updateProgress({ total: allFiles.length, phase: 'copy' });

    // Copy regular files first
    for (const file of regularFiles) {
      if (cancelRequested) throw new Error('cancelled');

      const rel = path.relative(sourceDir, file);
      const dest = path.join(resolvedTarget, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      updateProgress({ currentFile: rel });

      if (fsSeam?.copyFile) {
        await fsSeam.copyFile(file, dest);
      } else {
        fs.copyFileSync(file, dest);
      }

      const stat = fs.statSync(dest);
      updateProgress({
        copied: activeMoveStatus.copied + 1,
        bytesCopied: activeMoveStatus.bytesCopied + stat.size
      });
    }

    // Now copy DB last: flushDb -> closeDb -> copy -> verify magic header
    if (dbFiles.length > 0) {
      if (cancelRequested) throw new Error('cancelled');

      try {
        flushDb();
      } catch {
        // Ignore
      }
      closeDb();

      for (const dbFile of dbFiles) {
        if (cancelRequested) throw new Error('cancelled');

        const rel = path.relative(sourceDir, dbFile);
        const dest = path.join(resolvedTarget, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        updateProgress({ currentFile: rel });

        if (fsSeam?.copyFile) {
          await fsSeam.copyFile(dbFile, dest);
        } else {
          fs.copyFileSync(dbFile, dest);
        }

        const stat = fs.statSync(dest);
        updateProgress({
          copied: activeMoveStatus.copied + 1,
          bytesCopied: activeMoveStatus.bytesCopied + stat.size
        });
      }
    }

    // Phase: verify
    updateProgress({ phase: 'verify', currentFile: undefined });

    for (const file of allFiles) {
      if (cancelRequested) throw new Error('cancelled');

      const rel = path.relative(sourceDir, file);
      const dest = path.join(resolvedTarget, rel);

      if (fsSeam?.verifyFile) {
        const ok = await fsSeam.verifyFile(file, dest);
        if (!ok) throw new Error(`Verification failed for file: ${rel}`);
      } else {
        if (!fs.existsSync(dest)) {
          throw new Error(`Verification failed: missing target file ${rel}`);
        }
        const srcStat = fs.statSync(file);
        const destStat = fs.statSync(dest);
        if (srcStat.size !== destStat.size) {
          throw new Error(`Verification failed: size mismatch for ${rel}`);
        }
      }

      // If DB file, verify magic header
      if (path.basename(file) === 'antidetect.db') {
        if (!verifySqliteHeader(dest)) {
          throw new Error('Verification failed: invalid SQLite magic header');
        }
      }
    }

    // Phase: swap
    updateProgress({ phase: 'swap' });

    // Reopen DB at new root to rewrite profile absolute paths
    const targetDbPath = path.join(resolvedTarget, 'antidetect.db');
    const SQL = await initSqlJsPkg();
    if (fs.existsSync(targetDbPath)) {
      const data = fs.readFileSync(targetDbPath);
      const sqlDb = new SQL.Database(data);
      try {
        const res = sqlDb.exec('SELECT id, path FROM profiles');
        if (res.length > 0 && res[0].values) {
          const normSource = path.normalize(sourceDir).toLowerCase();
          for (const row of res[0].values) {
            const id = String(row[0]);
            const pPath = row[1] ? String(row[1]) : undefined;
            if (pPath && path.isAbsolute(pPath)) {
              const normP = path.normalize(pPath);
              if (normP.toLowerCase().startsWith(normSource)) {
                const rel = path.relative(sourceDir, normP);
                const newPath = path.join(resolvedTarget, rel);
                sqlDb.run('UPDATE profiles SET path = ? WHERE id = ?', [newPath, id]);
              }
            }
          }
          const exported = sqlDb.export();
          fs.writeFileSync(targetDbPath, Buffer.from(exported));
        }
      } finally {
        sqlDb.close();
      }
    }

    // Remove .incomplete marker from target
    if (fs.existsSync(incompleteMarker)) {
      fs.unlinkSync(incompleteMarker);
    }

    // Remove source lock
    if (fs.existsSync(sourceLock)) {
      fs.unlinkSync(sourceLock);
    }

    // Update persisted dataDir setting
    setDataDir(resolvedTarget);

    // Remove old root files (cleanup)
    try {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    } catch {
      // old root cleanup failure is non-fatal
    }

    updateProgress({ phase: 'done' });
    activeMoveStatus.inProgress = false;
    return { ok: true };
  } catch (err) {
    const isCancel = (err as Error).message === 'cancelled' || cancelRequested;
    const errMsg = isCancel ? 'Move cancelled' : (err as Error).message;

    // Clean up
    if (fs.existsSync(sourceLock)) {
      try {
        fs.unlinkSync(sourceLock);
      } catch {}
    }

    // If cancelled, clean partial target and remove .incomplete marker
    if (isCancel) {
      try {
        fs.rmSync(resolvedTarget, { recursive: true, force: true });
      } catch {}
    } else {
      // On verify/copy error, target remains with .incomplete marker, old root intact
    }

    // Make sure DB is re-opened at original sourceDir if closed
    try {
      if (!fs.existsSync(sourceLock)) {
        await initDb();
      }
    } catch {}

    updateProgress({ phase: 'error', error: errMsg });
    activeMoveStatus.inProgress = false;
    return { ok: false, error: errMsg };
  }
}
