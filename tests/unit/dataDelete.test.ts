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
 * The route's answer, as the renderer reads it. Named rather than `any` so a shape change at
 * the boundary is a compile error here instead of a runtime surprise in the UI.
 */
interface DeleteEnvelope {
  code: number;
  msg: string;
  data: {
    ok: boolean;
    dir: string;
    reason: string;
    recycled?: boolean;
    missing?: number;
  };
}

interface TransferEnvelope {
  code: number;
  msg: string;
  data: { ok: boolean; created: number; skipped: number; workspaces: number };
}

interface ScanEnvelope {
  code: number;
  data: { current: string; found: Array<{ dir: string; profiles: number }> };
}

/**
 * `POST /api/v1/data/delete` — removing an old data folder after it has been transferred out.
 *
 * The guards matter more than the deletion: this route is one click away from someone's
 * browser profile data, so the tests here are mostly about what it REFUSES to do. The
 * deletion itself is asserted on Windows, where it goes to the Recycle Bin rather than
 * unlinking the files — the reason it is safe to expose at all.
 */
describe('POST /api/v1/data/delete', () => {
  let app: Express;
  let server: http.Server;
  let baseUrl: string;
  let tempSrcDir: string;
  let SQLmodule: SqlJsStatic;

  const post = async (url: string, body: unknown): Promise<DeleteEnvelope & { data: { missing?: number } }> => {
    const resp = await fetch(`${baseUrl}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await resp.json()) as DeleteEnvelope & { data: { missing?: number } };
  };

  const transfer = async (from: string): Promise<TransferEnvelope> => {
    const resp = await fetch(`${baseUrl}/api/v1/data/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from }),
    });
    return (await resp.json()) as TransferEnvelope;
  };

  /**
   * A source folder shaped like a real older build's: a database with profiles, plus the
   * `profiles/<id>/` workspaces that hold the sessions. Both are what the guards look at.
   */
  const makeSourceFolder = (profileIds: string[]): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-del-src-'));
    const db = new SQLmodule.Database();
    db.exec(`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
    `);
    for (const id of profileIds) {
      // Raw sql.js takes ONE array of values; varargs bind nothing and write NULLs, which
      // would make the guard read profile ids of "null".
      db.prepare('INSERT INTO profiles VALUES (?, ?, 1, 1)').run([id, `Profile ${id}`]);
      fs.mkdirSync(path.join(dir, 'profiles', id, 'Default'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'profiles', id, 'Default', 'Cookies'), `cookies-${id}`);
    }
    fs.writeFileSync(path.join(dir, 'antidetect.db'), Buffer.from(db.export()));
    db.close();
    return dir;
  };

  const created: string[] = [];

  beforeEach(async () => {
    SQLmodule = await initSqlJs();
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
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const make = (profileIds: string[]): string => {
    const dir = makeSourceFolder(profileIds);
    created.push(dir);
    return dir;
  };

  it('refuses a folder that still holds profiles missing from the one in use', async () => {
    const from = make(['p_a', 'p_b']);
    // Only one of the two is here, so deleting would take `p_b` with it.
    getDb().prepare('INSERT INTO profiles (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)').run('p_a', 'a');

    const body = await post('/api/v1/data/delete', { dir: from });

    expect(body.code).toBe(-1);
    expect(body.data.ok).toBe(false);
    expect(body.data.reason).toBe('not-transferred');
    expect(body.data.missing).toBe(1);
    expect(fs.existsSync(path.join(from, 'antidetect.db'))).toBe(true);
  });

  it('refuses the data folder in use', async () => {
    const body = await post('/api/v1/data/delete', { dir: getDataDir() });

    expect(body.code).toBe(-1);
    expect(body.data.reason).toBe('current');
    expect(fs.existsSync(getDataDir())).toBe(true);
  });

  it('refuses a directory that is not a data folder', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-del-plain-'));
    created.push(plain);
    fs.writeFileSync(path.join(plain, 'holiday-photos.txt'), 'not a database');

    const body = await post('/api/v1/data/delete', { dir: plain });

    expect(body.code).toBe(-1);
    expect(body.data.reason).toBe('not-a-data-folder');
    expect(fs.existsSync(plain)).toBe(true);
  });

  it('refuses a folder that does not exist', async () => {
    const body = await post('/api/v1/data/delete', { dir: path.join(getDataDir(), 'nope') });

    expect(body.code).toBe(-1);
    expect(body.data.reason).toBe('missing');
  });

  /**
   * The journey the operator described: transfer into the folder in use, THEN delete the
   * leftover. Asserted end to end through the same routes the UI calls, because the point of
   * the feature is the sequence, not either half.
   */
  it('transfers, then deletes the source folder, and a following scan no longer lists it', async () => {
    const from = make(['p_one', 'p_two']);

    const moved = await transfer(from);
    expect(moved.code).toBe(0);
    expect(moved.data.created).toBe(2);

    // The scan only walks well-known locations, so this folder is checked directly.
    const beforeScan = fs.existsSync(from);
    expect(beforeScan).toBe(true);

    const body = await post('/api/v1/data/delete', { dir: from });

    if (process.platform === 'win32') {
      expect(body.code).toBe(0);
      expect(body.data.ok).toBe(true);
      expect(body.data.recycled).toBe(true);
      // The whole point: the folder is gone, and nothing it held was lost — the workspaces
      // came across with the transfer.
      expect(fs.existsSync(from)).toBe(false);
      expect(fs.readFileSync(path.join(getDataDir(), 'profiles', 'p_one', 'Default', 'Cookies'), 'utf8')).toBe(
        'cookies-p_one'
      );
    } else {
      // Explicitly refused rather than silently deleted permanently.
      expect(body.code).toBe(-1);
      expect(body.data.reason).toBe('unsupported-platform');
      expect(fs.existsSync(from)).toBe(true);
    }
  });

  it('reports the scan as the UI reads it, so a re-scan can be asserted', async () => {
    const resp = await fetch(`${baseUrl}/api/v1/data/scan`);
    const body = (await resp.json()) as ScanEnvelope;

    expect(body.code).toBe(0);
    expect(Array.isArray(body.data.found)).toBe(true);
    // Every entry carries the fields the row renders; an absent `profiles` would render NaN.
    for (const f of body.data.found) {
      expect(typeof f.dir).toBe('string');
      expect(typeof f.profiles).toBe('number');
    }
  });
});
