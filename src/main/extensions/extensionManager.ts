// Extension library: import unpacked/zip extensions, bind them to profiles,
// and resolve the on-disk paths passed to --load-extension.
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { getDb } from '../db';
import { EXTENSIONS_DIR } from '../config';

export interface ExtensionRow {
  id: string;
  name: string;
  path: string;
  version: string | null;
  enabled: number;
  created_at: number;
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function readManifestVersion(extDir: string): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/** Import an extension from an unpacked folder or a .zip. Returns the extension id. */
export function importExtension(name: string, sourcePath: string): string {
  if (!fs.existsSync(sourcePath)) throw new Error('source path not found');
  const db = getDb();
  const id = 'ext_' + randomUUID();
  const dest = path.join(EXTENSIONS_DIR, id);

  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    copyDir(sourcePath, dest);
  } else if (stat.isFile() && /\.zip$/i.test(sourcePath)) {
    const zip = new AdmZip(sourcePath);
    zip.extractAllTo(dest, true);
  } else {
    throw new Error('unsupported source: provide an unpacked folder or a .zip');
  }

  if (!fs.existsSync(path.join(dest, 'manifest.json'))) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error('invalid extension: manifest.json not found');
  }

  const version = readManifestVersion(dest);
  db.prepare(
    'INSERT INTO extensions (id, name, path, version, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, dest, version, 1, Date.now());
  return id;
}

export function listExtensions(): ExtensionRow[] {
  return getDb().prepare('SELECT * FROM extensions ORDER BY created_at DESC').all() as ExtensionRow[];
}

export function getExtension(id: string): ExtensionRow | undefined {
  return getDb().prepare('SELECT * FROM extensions WHERE id = ?').get(id) as ExtensionRow | undefined;
}

export function deleteExtension(id: string): boolean {
  const db = getDb();
  const ext = getExtension(id);
  if (!ext) return false;
  db.prepare('DELETE FROM profile_extensions WHERE extension_id = ?').run(id);
  db.prepare('DELETE FROM extensions WHERE id = ?').run(id);
  try {
    fs.rmSync(ext.path, { recursive: true, force: true });
  } catch {
    // ignore
  }
  return true;
}

/** Replace the set of extensions bound to a profile. */
export function bindExtensions(profileId: string, extensionIds: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM profile_extensions WHERE profile_id = ?').run(profileId);
  const ins = db.prepare('INSERT OR IGNORE INTO profile_extensions (profile_id, extension_id) VALUES (?, ?)');
  for (const extId of extensionIds) ins.run(profileId, extId);
}

export function getProfileExtensionIds(profileId: string): string[] {
  const rows = getDb()
    .prepare('SELECT extension_id FROM profile_extensions WHERE profile_id = ?')
    .all(profileId) as Array<{ extension_id: string }>;
  return rows.map((r) => r.extension_id);
}

/** Absolute paths of the enabled extensions bound to a profile (for --load-extension). */
export function getEnabledExtensionPaths(profileId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT e.path FROM profile_extensions pe JOIN extensions e ON e.id = pe.extension_id
       WHERE pe.profile_id = ? AND e.enabled = 1`
    )
    .all(profileId) as Array<{ path: string }>;
  return rows.map((r) => r.path).filter((p) => fs.existsSync(p));
}
