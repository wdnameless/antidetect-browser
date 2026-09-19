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
    workspaces: number;
    workspace_failures: Array<{ id: string; error: string }>;
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

  /**
   * The rows are metadata; the sessions are on disk. A profile's logins and cookies live in
   * `profiles/<id>/Default/{Cookies,Login Data,Local Storage}`, and `cookies_json` is
   * typically NULL. Copying rows alone produces a profile that lists and launches as a
   * brand-new browser with every login gone — which is why deletion is only safe once the
   * workspace comes across too.
   */
  it('copies the profile workspaces, not just the rows', async () => {
    const from = saveSource(fullSchemaSource);
    fs.mkdirSync(path.join(from, 'profiles', 'p1', 'Default'), { recursive: true });
    fs.writeFileSync(path.join(from, 'profiles', 'p1', 'Default', 'Login Data'), 'session-bytes');
    fs.mkdirSync(path.join(from, 'profiles', 'p2', 'Default'), { recursive: true });
    fs.writeFileSync(path.join(from, 'profiles', 'p2', 'Default', 'Cookies'), 'cookie-bytes');

    const body = await post(from);

    expect(body.code).toBe(0);
    expect(body.data.workspaces).toBe(2);
    expect(body.data.workspaces_verified).toBe(2);
    expect(body.data.workspace_failures).toEqual([]);
    expect(fs.readFileSync(path.join(getDataDir(), 'profiles', 'p1', 'Default', 'Login Data'), 'utf8')).toBe(
      'session-bytes'
    );
    expect(fs.readFileSync(path.join(getDataDir(), 'profiles', 'p2', 'Default', 'Cookies'), 'utf8')).toBe('cookie-bytes');
  });

  /**
   * A second transfer must not overwrite the folder in use: for a profile the destination
   * already has, its own workspace is the authoritative one and the source is the stale copy.
   */
  it('does not overwrite an existing destination workspace', async () => {
    const from = saveSource(fullSchemaSource);
    fs.mkdirSync(path.join(from, 'profiles', 'p1', 'Default'), { recursive: true });
    fs.writeFileSync(path.join(from, 'profiles', 'p1', 'Default', 'Cookies'), 'source-older');

    const destCookie = path.join(getDataDir(), 'profiles', 'p1', 'Default', 'Cookies');
    fs.mkdirSync(path.dirname(destCookie), { recursive: true });
    fs.writeFileSync(destCookie, 'destination-newer');

    await post(from);

    expect(fs.readFileSync(destCookie, 'utf8')).toBe('destination-newer');
  });

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
    expect(second.data.updated).toBe(0);
    expect(second.data.skipped).toBe(2);
    expect(second.data.dependencies).toBe(0);
  });

  it('an already-identical row reports skipped and does not appear in updated', async () => {
    const dstDb = getDb();
    dstDb.prepare("INSERT INTO profiles (id, name, created_at, updated_at) VALUES ('p-ident','Same Name',100,100)").run();

    const from = saveSource((db) => {
      db.exec(`
        CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        INSERT INTO profiles VALUES ('p-ident','Same Name',100,100);
      `);
    });

    const body = await post(from);
    expect(body.code).toBe(0);
    expect(body.data.created).toBe(0);
    expect(body.data.updated).toBe(0);
    expect(body.data.skipped).toBe(1);
  });

  it('destination profile whose id also exists in the source replaces stale name with source name and is counted as updated', async () => {
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
    expect(body.data.updated).toBe(1);
    expect(body.data.skipped).toBe(0);

    const updated = getDb().prepare("SELECT name FROM profiles WHERE id = 'p-same'").get() as { name: string };
    expect(updated.name).toBe('Overwritten Source Name');
  });

  it('a transfer does not rewrite the live state of a profile that is running here', async () => {
    // The source folder is a snapshot of another machine, so its `status` describes THAT machine.
    // Copying it would mark a profile that is open right here as closed — the same rule the
    // repository already applies to maintenance, where a running profile is skipped untouched.
    const dstDb = getDb();
    dstDb
      .prepare(
        "INSERT INTO profiles (id, name, status, created_at, updated_at) VALUES ('p-live','Old Name','running',111,222)",
      )
      .run();

    const from = saveSource((db) => {
      db.exec(`
        CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, status TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        INSERT INTO profiles VALUES ('p-live','Source Name','closed',1,1);
      `);
    });

    const body = await post(from);
    expect(body.code).toBe(0);
    expect(body.data.updated).toBe(1);

    const row = getDb()
      .prepare("SELECT name, status, created_at, updated_at FROM profiles WHERE id = 'p-live'")
      .get() as { name: string; status: string; created_at: number; updated_at: number };

    // The operator's data comes from the source...
    expect(row.name).toBe('Source Name');
    // ...but the live state stays this installation's.
    expect(row.status).toBe('running');
    expect(row.created_at).toBe(111);
    expect(row.updated_at).toBe(222);
  });

  it('carries profile-keyed dependent rows and reports dependents > 0', async () => {
    const from = saveSource((db) => {
      db.exec(`
        CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE extensions (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT, enabled INTEGER);
        CREATE TABLE profile_extensions (profile_id TEXT NOT NULL, extension_id TEXT NOT NULL, launch_args TEXT, PRIMARY KEY(profile_id, extension_id));
        CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE profile_tags (profile_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY(profile_id, tag_id));

        INSERT INTO extensions VALUES ('ext-1', 'UBlock', '1.0', 1);
        INSERT INTO tags VALUES ('tag-1', 'Crypto');
        INSERT INTO profiles VALUES ('p-dep', 'Dep Profile', 1, 1);
        INSERT INTO profile_extensions VALUES ('p-dep', 'ext-1', '--arg');
        INSERT INTO profile_tags VALUES ('p-dep', 'tag-1');
      `);
    });

    const body = await post(from);
    expect(body.code).toBe(0);
    expect(body.data.created).toBe(1);
    expect(body.data.dependencies).toBe(1); // ext-1
    expect(body.data.dependents).toBe(2); // profile_extensions + profile_tags

    const extRow = getDb().prepare("SELECT * FROM profile_extensions WHERE profile_id = 'p-dep'").get() as {
      extension_id: string;
      launch_args: string;
    };
    expect(extRow).toBeDefined();
    expect(extRow.extension_id).toBe('ext-1');
    expect(extRow.launch_args).toBe('--arg');

    const tagRow = getDb().prepare("SELECT * FROM profile_tags WHERE profile_id = 'p-dep'").get() as {
      tag_id: string;
    };
    expect(tagRow).toBeDefined();
    expect(tagRow.tag_id).toBe('tag-1');
  });

  it('a source row that the destination must refuse errors instead of reporting success', async () => {
    // Destination profiles table has:
    // CREATE TABLE profiles (id TEXT PRIMARY KEY, ...);
    // Destination also has foreign keys or constraints. But in proxy.ts, if an insert fails and the row
    // does NOT exist in destination, it throws:
    // `${table} row ${String(rowId)} could not be imported and is not already present — the insert was refused by the destination schema`
    // For instance, a destination table with a UNIQUE constraint or NOT NULL column without a default where filler cannot satisfy,
    // OR a dependent table row referencing a non-existent foreign key when foreign_keys = ON:
    const dstDb = getDb();
    dstDb.exec('CREATE TABLE strict_table (id TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(length(value) > 5))');
    // Or in profiles table itself, insert a row that violates destination CHECK or NOT NULL constraint or trigger:
    dstDb.exec('CREATE TRIGGER fail_on_bad_profile BEFORE INSERT ON profiles WHEN NEW.name = "REFUSED_NAME" BEGIN SELECT RAISE(ABORT, "refused by schema trigger"); END;');

    const from = saveSource((db) => {
      db.exec(`
        CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        INSERT INTO profiles VALUES ('p-refused', 'REFUSED_NAME', 1, 1);
      `);
    });

    const body = await post(from);
    expect(body.code).toBe(-1);
    expect(body.data.ok).toBe(false);
    expect(body.data.created).toBe(0);
    expect(body.data.error).toMatch(/refused/i);
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
