// SQLite via sql.js (WASM) — no native modules, works in Node AND Electron main
// without rebuilds (ADR-007). API mimics the better-sqlite3 surface we use.
//
// Durability model (v0.2.16):
// - Writes are persisted with a short debounce (100 ms) instead of a full-DB
//   export on every single statement.
// - Persistence is ATOMIC: data is written to "<DB_PATH>.tmp" and renamed over
//   the live file, so a crash mid-write can never corrupt the database.
// - A daily rotating backup is stored in <DATA_DIR>/backups (last 5 kept).
// - flushDb() forces an immediate persist (used on shutdown / before backups).
import initSqlJs, { Database as SqlJsDatabase, SqlValue } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { DB_PATH, DATA_DIR } from '../config';
import { migrate } from './schema';

interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  close(): void;
}

const PERSIST_DEBOUNCE_MS = 100;
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = 5;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let sqlModule: Awaited<ReturnType<typeof initSqlJs>> | null = null;
let db: Database | null = null;
let instanceRef: SqlJsDatabase | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let exitHookInstalled = false;

async function getSqlModule(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  if (!sqlModule) sqlModule = await initSqlJs();
  return sqlModule;
}

function normalize(params: unknown[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : (p as SqlValue)));
}

/** Atomically write the current DB image to disk (tmp file + rename). */
function persistNow(instance: SqlJsDatabase): void {
  const data = instance.export();
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(data));
  // rename over an existing file is atomic (Node uses MOVEFILE_REPLACE_EXISTING on Windows)
  fs.renameSync(tmp, DB_PATH);
}

function schedulePersist(instance: SqlJsDatabase): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      persistNow(instance);
    } catch (err) {
      console.error('[db] persist failed:', (err as Error).message);
    }
  }, PERSIST_DEBOUNCE_MS);
  // never keep the process alive just for a pending flush
  if (typeof persistTimer.unref === 'function') persistTimer.unref();
}

/** Force an immediate synchronous persist of the current DB state. */
export function flushDb(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (instanceRef) {
    try {
      persistNow(instanceRef);
    } catch (err) {
      console.error('[db] flush failed:', (err as Error).message);
    }
  }
}

/** Daily rotating backup: keep the last BACKUP_KEEP copies in <DATA_DIR>/backups. */
function maybeBackup(instance: SqlJsDatabase): void {
  try {
    if (!fs.existsSync(DB_PATH)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const stampFile = path.join(BACKUP_DIR, '.last-backup');
    const last = fs.existsSync(stampFile) ? Number(fs.readFileSync(stampFile, 'utf8').trim()) : 0;
    if (Number.isFinite(last) && Date.now() - last < BACKUP_INTERVAL_MS) return;

    // make sure the on-disk copy is current before cloning it
    persistNow(instance);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `antidetect-${stamp}.db`));
    fs.writeFileSync(stampFile, String(Date.now()), 'utf8');

    // rotate: newest last by name (timestamp in the filename)
    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('antidetect-') && f.endsWith('.db'))
      .sort();
    while (backups.length > BACKUP_KEEP) {
      const oldest = backups.shift();
      if (oldest) fs.rmSync(path.join(BACKUP_DIR, oldest), { force: true });
    }
    console.log('[db] backup created:', `antidetect-${stamp}.db`);
  } catch (err) {
    // backups are best-effort; never block startup
    console.error('[db] backup failed:', (err as Error).message);
  }
}

export async function initDb(): Promise<void> {
  const SQL = await getSqlModule();
  let instance: SqlJsDatabase;
  if (fs.existsSync(DB_PATH)) {
    instance = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    instance = new SQL.Database();
  }
  instanceRef = instance;

  // Sync flush on normal process exit ('exit' handlers must be synchronous).
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      if (instanceRef) {
        try {
          persistNow(instanceRef);
        } catch {
          // last resort — nothing sensible to do at exit
        }
      }
    });
  }

  maybeBackup(instance);

  db = {
    prepare(sql: string): Statement {
      return {
        run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
          const stmt = instance.prepare(sql);
          try {
            if (params.length > 0) stmt.bind(normalize(params));
            stmt.step();
            const changes = instance.getRowsModified();
            schedulePersist(instance);
            return { changes, lastInsertRowid: 0 };
          } finally {
            stmt.free();
          }
        },
        get(...params: unknown[]): unknown {
          const stmt = instance.prepare(sql);
          try {
            if (params.length > 0) stmt.bind(normalize(params));
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params: unknown[]): unknown[] {
          const stmt = instance.prepare(sql);
          try {
            if (params.length > 0) stmt.bind(normalize(params));
            const rows: unknown[] = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally {
            stmt.free();
          }
        },
      };
    },
    exec(sql: string): void {
      instance.exec(sql);
      schedulePersist(instance);
    },
    close(): void {
      persistNow(instance);
      instance.close();
      instanceRef = null;
    },
  };

  migrate(db);
}

export function getDb(): Database {
  if (!db) throw new Error('database not initialized (call initDb first)');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
