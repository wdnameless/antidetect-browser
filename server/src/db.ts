// SQLite via sql.js (WASM) — same persistence approach as the desktop app
// (ADR-007): no native modules, atomic writes, debounced flush.
import initSqlJs, { Database as SqlJsDatabase, SqlValue } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = process.env.SYNC_DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'sync.db');
const FLUSH_DEBOUNCE_MS = 200;

interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
}

let instance: SqlJsDatabase | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function persistNow(): void {
  if (!instance) return;
  const data = instance.export();
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, DB_PATH);
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      persistNow();
    } catch (err) {
      console.error('[sync-server] persist failed:', (err as Error).message);
    }
  }, FLUSH_DEBOUNCE_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

function wrap(inst: SqlJsDatabase): Database {
  return {
    prepare(sql: string): Statement {
      return {
        run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
          const stmt = inst.prepare(sql);
          try {
            if (params.length > 0) stmt.bind(params as SqlValue[]);
            stmt.step();
            scheduleFlush();
            return { changes: inst.getRowsModified(), lastInsertRowid: 0 };
          } finally {
            stmt.free();
          }
        },
        get(...params: unknown[]): unknown {
          const stmt = inst.prepare(sql);
          try {
            if (params.length > 0) stmt.bind(params as SqlValue[]);
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params: unknown[]): unknown[] {
          const stmt = inst.prepare(sql);
          try {
            if (params.length > 0) stmt.bind(params as SqlValue[]);
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
      inst.exec(sql);
      scheduleFlush();
    },
  };
}

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  instance = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  process.on('exit', () => {
    try {
      persistNow();
    } catch {
      // last resort
    }
  });
  const db = wrap(instance);
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id              TEXT PRIMARY KEY,
      name            TEXT,
      owner_device_id TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id     TEXT NOT NULL,
      member_id   TEXT NOT NULL,
      email       TEXT,
      role        TEXT NOT NULL CHECK (role IN ('owner','member')),
      permissions TEXT,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
      key_blob    TEXT,
      joined_at   INTEGER,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (team_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS team_bundles (
      team_id    TEXT NOT NULL,
      bundle_id  TEXT NOT NULL,
      device_id  TEXT,
      ciphertext TEXT NOT NULL,
      version    INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, bundle_id)
    );
  `);
}

export function getDb(): Database {
  if (!instance) throw new Error('db not initialized');
  return wrap(instance);
}