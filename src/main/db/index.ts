// SQLite via sql.js (WASM) — no native modules, works in Node AND Electron main
// without rebuilds (ADR-007). API mimics the better-sqlite3 surface we use.
import initSqlJs, { Database as SqlJsDatabase, SqlValue } from 'sql.js';
import * as fs from 'fs';
import { DB_PATH } from '../config';
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

let sqlModule: Awaited<ReturnType<typeof initSqlJs>> | null = null;
let db: Database | null = null;

async function getSqlModule(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  if (!sqlModule) sqlModule = await initSqlJs();
  return sqlModule;
}

function normalize(params: unknown[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : (p as SqlValue)));
}

export async function initDb(): Promise<void> {
  const SQL = await getSqlModule();
  let instance: SqlJsDatabase;
  if (fs.existsSync(DB_PATH)) {
    instance = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    instance = new SQL.Database();
  }

  const persist = (): void => {
    const data = instance.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  };

  // Each run/get/all prepares a FRESH statement so prepared statements can be
  // safely reused (better-sqlite3 semantics) without "Statement closed" errors.
  db = {
    prepare(sql: string): Statement {
      return {
        run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
          const stmt = instance.prepare(sql);
          try {
            if (params.length > 0) stmt.bind(normalize(params));
            stmt.step();
            const changes = instance.getRowsModified();
            return { changes, lastInsertRowid: 0 };
          } finally {
            stmt.free();
            persist();
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
      persist();
    },
    close(): void {
      persist();
      instance.close();
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
