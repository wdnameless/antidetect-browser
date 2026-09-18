import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import proxyRouter from '../../src/main/api/routes/proxy';
import { initDb, closeDb, getDb } from '../../src/main/db';
import { getDataDir } from '../../src/main/config';

/**
 * The route's answer, as the renderer reads it. Asserted through a named type rather than
 * `any` so a shape change at the boundary is a compile error here, not a runtime surprise.
 */
interface TransferEnvelope {
  code: number;
  msg: string;
  data: {
    ok: boolean;
    from: string;
    created: number;
    skipped: number;
    dependencies: number;
    error?: string;
  };
}

describe('POST /api/v1/data/transfer', () => {
  let app: Express;
  let server: http.Server;
  let baseUrl: string;
  let tempSrcDir: string;

  const post = async (from: string): Promise<TransferEnvelope> => {
    const resp = await fetch(`${baseUrl}/api/v1/data/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from }),
    });
    // Our own route, in-process: the envelope shape is pinned by TransferEnvelope above.
    return (await resp.json()) as TransferEnvelope;
  };

  const saveSource = (build: (db: SqlJsDatabase) => void): string => {
    const db = new SQLmodule.Database();
    build(db);
    fs.writeFileSync(path.join(tempSrcDir, 'antidetect.db'), Buffer.from(db.export()));
    db.close();
    return tempSrcDir;
  };

  let SQLmodule: SqlJsStatic;

  beforeEach(async () => {
    SQLmodule = await initSqlJs();
    tempSrcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-test-src-'));

    // Every test starts from an empty destination database. The sandbox data dir is shared
    // across this file, and `closeDb()` persists it, so the file is removed and recreated —
    // otherwise a later test inherits the profiles an earlier one imported.
    try {
      closeDb();
    } catch {
      // first test in the file: never opened
    }
    fs.rmSync(path.join(getDataDir(), 'antidetect.db'), { force: true });
    await initDb();

    app = express();
    app.use(express.json());
    app.use(proxyRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(server.address() as http.AddressInfo).port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      closeDb();
    } catch {
      // already closed
    }
    fs.rmSync(tempSrcDir, { recursive: true, force: true });
  });

  /**
   * A source database shaped like a real older build's: every NOT NULL column the destination
   * declares, present. This is the ordinary case — the operator's previous data folder.
   */
  const fullSchemaSource = (db: SqlJsDatabase): void => {
    db.exec(`
      CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE proxies (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL,
        username TEXT, password TEXT, country TEXT, timezone TEXT, status TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE fingerprints (
        id TEXT PRIMARY KEY, label TEXT, seed INTEGER NOT NULL, config_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, config_json TEXT NOT NULL);
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY, name TEXT, group_id TEXT, proxy_id TEXT, fingerprint_id TEXT, device_id TEXT,
        browser_type TEXT, user_agent TEXT, timezone TEXT, status TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO groups VALUES ('g1','Alpha Group', 1700000000000);
      INSERT INTO proxies VALUES ('px1','http','1.2.3.4',8080,NULL,NULL,'US','America/New_York','unknown', 1700000000000);
      INSERT INTO fingerprints VALUES ('fp1','default',1558543766,'{"platform":"windows"}', 1700000000000);
      INSERT INTO devices VALUES ('d1','Device 1','windows','{}');
      INSERT INTO profiles VALUES ('p1','Profile 1','g1','px1','fp1','d1','chromium',NULL,NULL,'closed', 1700000000000, 1700000000000);
      INSERT INTO profiles VALUES ('p2','Profile 2','g1','px1','fp1','d1','chromium',NULL,NULL,'closed', 1700000000000, 1700000000000);
    `);
  };

  it('transfers into an empty destination: creates every profile AND its dependencies', async () => {
    const from = saveSource(fullSchemaSource);
    const body = await post(from);

    expect(body.code).toBe(0);
    expect(body.data.ok).toBe(true);
    expect(body.data.from).toBe(from);
    expect(body.data.created).toBe(2);
    expect(body.data.skipped).toBe(0);
    expect(body.data.dependencies).toBe(4); // g1 + px1 + fp1 + d1

    const dstDb = getDb();
    expect(dstDb.prepare('SELECT id FROM profiles ORDER BY id').all()).toHaveLength(2);
    expect(dstDb.prepare('SELECT id FROM groups').all()).toHaveLength(1);
    expect(dstDb.prepare('SELECT id FROM fingerprints').all()).toHaveLength(1);
    // The reference must resolve, or the profile cannot be launched.
    const row = dstDb.prepare("SELECT fingerprint_id, device_id FROM profiles WHERE id = 'p1'").get() as {
      fingerprint_id: string;
      device_id: string;
    };
    expect(row.fingerprint_id).toBe('fp1');
    expect(row.device_id).toBe('d1');
  });

  it('imports a source whose schema predates NOT NULL columns the destination requires', async () => {
    // The defect this pins: `INSERT OR IGNORE` does NOT fail on a NOT NULL violation — SQLite
    // skips the row and reports zero changes, exactly as it does for a duplicate. The route
    // counted that as "already present", so a transfer could report success and move nothing.
    const from = saveSource((db) => {
      db.exec(`
        CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO profiles VALUES ('p-old','Legacy Profile');
      `);
    });

    const body = await post(from);

    expect(body.code).toBe(0);
    expect(body.data.created).toBe(1);
    expect(body.data.skipped).toBe(0);
    const row = getDb().prepare("SELECT name FROM profiles WHERE id = 'p-old'").get() as { name: string };
    expect(row.name).toBe('Legacy Profile');
  });

  it('second transfer of the same folder creates nothing and skips profiles', async () => {
    const from = saveSource(fullSchemaSource);

    const first = await post(from);
    expect(first.data.created).toBe(2);
    expect(first.data.skipped).toBe(0);

    const second = await post(from);
    expect(second.data.created).toBe(0);
    expect(second.data.skipped).toBe(2);
    expect(second.data.dependencies).toBe(0);
  });

  it('destination profile whose id also exists in the source keeps its own values and is counted as skipped', async () => {
    const dstDb = getDb();
    dstDb.prepare("INSERT INTO profiles (id, name, created_at, updated_at) VALUES ('p-same','Original Dest Name',1,1)").run();

    const from = saveSource((db) => {
      db.exec(`
        CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        INSERT INTO profiles VALUES ('p-same','Overwritten Source Name',1,1);
        INSERT INTO profiles VALUES ('p-new','New Source Profile',1,1);
      `);
    });

    const body = await post(from);
    expect(body.code).toBe(0);
    expect(body.data.created).toBe(1);
    expect(body.data.skipped).toBe(1);

    const preserved = getDb().prepare("SELECT name FROM profiles WHERE id = 'p-same'").get() as { name: string };
    expect(preserved.name).toBe('Original Dest Name');
  });

  it('source profile with a dangling FK is still created', async () => {
    const from = saveSource((db) => {
      db.exec(`
        CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, group_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        INSERT INTO profiles VALUES ('p-orphan','Orphan Profile','non-existent-group-id',1,1);
      `);
    });

    const body = await post(from);
    expect(body.code).toBe(0);
    expect(body.data.created).toBe(1);
    expect(body.data.skipped).toBe(0);

    const row = getDb().prepare("SELECT id, group_id FROM profiles WHERE id = 'p-orphan'").get() as {
      id: string;
      group_id: string;
    };
    expect(row.id).toBe('p-orphan');
    expect(row.group_id).toBe('non-existent-group-id');
  });

  it('missing or corrupt source produces a stated error and created: 0', async () => {
    const missing = await post(tempSrcDir);
    expect(missing.code).toBe(-1);
    expect(missing.data.created).toBe(0);
    expect(missing.data.error).toMatch(/missing/i);

    fs.writeFileSync(path.join(tempSrcDir, 'antidetect.db'), 'NOT_A_SQLITE_DATABASE');
    const corrupt = await post(tempSrcDir);
    expect(corrupt.code).toBe(-1);
    expect(corrupt.data.created).toBe(0);
    expect(corrupt.data.error).toMatch(/corrupt|unreadable/i);
  });

  it('transferring the folder in use is refused', async () => {
    // The folder "in use" is the module-level DATA_DIR (config.ts resolves it once at import) —
    // NOT a path passed to setDataDir, which only records a choice for the next start.
    const inUse = getDataDir();
    const body = await post(inUse);

    expect(body.code).toBe(-1);
    expect(body.msg).toBe('source is the data folder in use');
    expect(body.data.ok).toBe(false);
    expect(body.data.created).toBe(0);
    expect(body.data.error).toBe('source is the data folder in use');
  });
});
