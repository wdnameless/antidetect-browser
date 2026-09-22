// Profile-directory sync: what is worth moving between machines, and what is not.
//
// The operator asked for "all data, including the Chromium folders (795 MB)". Measured on a real
// install, that 785 MB decomposes as follows:
//
//   profiles/*/ (total)                                    785.0 MB
//     regenerated caches (Cache, Code Cache, Service
//       Worker, GPUCache, Dawn*, ShaderCache, ...)           759.8 MB   <- 96.8%
//     valuable site state (Local Storage, IndexedDB,
//       Network/Cookies, Sessions, WebStorage, Local State)    1.75 MB
//     unclassified Chromium bookkeeping                        23.5 MB
//
// `Default/Service Worker` alone is 197 MB. Copying the caches would move a gigabyte-scale payload
// on every run, burn the operator's Drive quota, and still not achieve the goal — the second
// machine rebuilds caches on demand, and the cookie store it finds there is unreadable anyway
// (Chromium wraps that key with Windows DPAPI, per machine; see io/cookieSqlite.ts, which exists
// precisely to unwrap and re-key it). Sessions travel between machines through `profiles.cookies_json`,
// which the database sync already carries — not through these directories.
//
// So two tiers exist, both opt-in, with the real cost shown to the operator:
//   site-state  - the 1.75 MB that carries logins and app state
//   full mirror - every profile file except the regenerated caches, for completeness
//
// Both collect only STOPPED profiles. `Local Storage` and `IndexedDB` are LevelDB stores: a copy
// taken while Chromium holds them is torn mid-write, and the `LOCK` file inside travels with it —
// landing a stale `LOCK` on the target machine can wedge the profile so it never opens again.

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { isRunning } from '../launcher/chromium';
import { resolveProfileDir } from '../io/cookieSqlite';
import { listProfiles } from '../profiles/profileManager';

/**
 * Directories and files inside a Chromium profile that are regenerated on demand.
 *
 * Excluded from every tier. `Service Worker` is the largest single item (197 MB measured) and is
 * pure cache; `BrowserMetrics`/`Crashpad` are telemetry and crash dumps, which are also a privacy
 * leak if they travel.
 */
const REGENERATED_DIRS = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnWebGPUCache',
  'DawnGraphiteCache',
  'ShaderCache',
  'GrShaderCache',
  'Service Worker',
  'Shared Dictionary',
  'BrowserMetrics',
  'Crashpad',
  'component_crx_cache',
  'extensions_crx_cache',
  'optimization_guide_model_store',
  'Safe Browsing',
]);

/**
 * Files that hold a lock, a port, or a machine-bound secret. Never travel:
 * - `lockfile` / `Singleton*` — Chromium's own exclusivity locks. A stale one on the target
 *   machine is the classic "profile will not start" failure.
 * - `Local State` — carries `os_crypt.encrypted_key`, which is DPAPI-wrapped and therefore
 *   useless on another machine; copying it invites a half-restored, unreadable cookie store.
 * - `DevToolsActivePort` — a port number from the source machine.
 */
const FORBIDDEN_FILES = new Set([
  'lockfile',
  'Local State',
  'Local State-journal',
  'DevToolsActivePort',
]);

/** LevelDB/ SQLite sidecar files that are only valid alongside a cleanly-closed store. */
const TRANSIENT_SUFFIXES = ['-journal', '-wal', '-shm', '.tmp'];

/** The tier that actually carries a login across machines. */
const SITE_STATE_DIRS = ['Local Storage', 'IndexedDB', 'Sessions', 'WebStorage', 'Session Storage', 'Network'];

export interface MirrorProgress {
  files: number;
  totalFiles: number;
  uploadedBytes: number;
}

export interface MirrorResult {
  /** Size of the archive as uploaded. */
  archiveBytes: number;
  fileCount: number;
  /** Profiles that were skipped because they were running, with the reason. */
  skipped: Array<{ profileId: string; reason: string }>;
  /** Paths excluded by policy, so the operator can see what the tier left behind. */
  excluded: string[];
}

function shouldSkipDir(name: string): boolean {
  return REGENERATED_DIRS.has(name);
}

function shouldSkipFile(name: string): boolean {
  if (FORBIDDEN_FILES.has(name)) return true;
  return TRANSIENT_SUFFIXES.some((s) => name.endsWith(s));
}

interface CollectedFile {
  /** Path relative to the profile root, POSIX separators so a Linux/macOS restore works. */
  rel: string;
  abs: string;
  size: number;
}

/**
 * Walk one profile directory, keeping only what the requested tier considers portable.
 *
 * `siteStateOnly` selects the small tier. Neither tier keeps caches, so both stay honest about what
 * a restore can actually reproduce.
 */
function collectProfileFiles(profileDir: string, siteStateOnly: boolean): { files: CollectedFile[]; excluded: string[] } {
  const files: CollectedFile[] = [];
  const excluded: string[] = [];

  /**
   * `insideSiteState` tracks whether an ancestor is one of SITE_STATE_DIRS.
   *
   * It has to be threaded through the recursion rather than re-derived from the directory name,
   * because the data does not sit at the top of those directories: `Local Storage` and `IndexedDB`
   * are LevelDB stores, so the actual bytes live one level deeper in `leveldb/`, and the useful
   * IndexedDB files (`*.blob`, `*.ldb`, `LOG`) sit inside a per-origin directory. Matching only the
   * allow-listed name collected zero files and the tier silently shipped nothing.
   */
  const walk = (dir: string, insideSiteState: boolean): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // an unreadable subdirectory is skipped, not fatal
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(profileDir, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) {
          excluded.push(rel);
          continue;
        }
        if (!siteStateOnly) {
          walk(abs, false);
          continue;
        }
        const isTopLevel = !rel.includes('/');
        if (insideSiteState || isTopLevel || SITE_STATE_DIRS.includes(entry.name)) {
          walk(abs, insideSiteState || SITE_STATE_DIRS.includes(entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldSkipFile(entry.name)) {
        excluded.push(rel);
        continue;
      }
      // In the small tier, files loose at the profile root and directly under `Default/` are kept:
      // they are small (a few hundred KB in total — `Preferences`, `Login Data`, `Web Data`) and
      // they carry state a restore wants. Everything deeper is kept only inside an allow-listed
      // subtree, which is what keeps this tier at ~1.75 MB instead of the full tree.
      if (siteStateOnly && !insideSiteState) {
        const depth = rel.split('/').length;
        if (depth > 2) continue;
      }
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        continue;
      }
      files.push({ rel, abs, size });
    }
  };

  walk(profileDir, false);
  return { files, excluded };
}

export interface SiteStateArchive {
  profileId: string;
  /** gzip'd tar-ish container: one entry per file, framed, so no tar dependency is needed. */
  blob: Buffer;
  fileCount: number;
  bytes: number;
  excluded: string[];
}

/**
 * Frame a set of files into one self-describing buffer.
 *
 * Format (little-endian lengths) — deliberately dependency-free rather than pulling in a tar
 * library for a format we fully control:
 *   MAGIC "NTSA" | version u8 | entryCount u32
 *   per entry: relPathLen u16 | relPath utf8 | dataLen u32 | data
 * The whole thing is gzip'd once at the end, which is where the real saving is.
 */
export function frameFiles(entries: Array<{ rel: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(4 + 1 + 4);
  header.write('NTSA', 0, 'latin1');
  header.writeUInt8(1, 4);
  header.writeUInt32LE(entries.length, 5);
  parts.push(header);

  for (const e of entries) {
    const nameBuf = Buffer.from(e.rel, 'utf8');
    const nameLen = Buffer.alloc(2);
    nameLen.writeUInt16LE(nameBuf.length, 0);
    const dataLen = Buffer.alloc(4);
    dataLen.writeUInt32LE(e.data.length, 0);
    parts.push(nameLen, nameBuf, dataLen, e.data);
  }
  return zlib.gzipSync(Buffer.concat(parts));
}

/** Inverse of `frameFiles`. Throws on a malformed container rather than writing partial garbage. */
export function unframeFiles(blob: Buffer): Array<{ rel: string; data: Buffer }> {
  const raw = zlib.gunzipSync(blob);
  if (raw.length < 9 || raw.subarray(0, 4).toString('latin1') !== 'NTSA') {
    throw new Error('not a NullTrace site-state archive');
  }
  const version = raw.readUInt8(4);
  if (version !== 1) throw new Error(`unsupported site-state archive version: ${version}`);
  const count = raw.readUInt32LE(5);

  const out: Array<{ rel: string; data: Buffer }> = [];
  let off = 9;
  for (let i = 0; i < count; i += 1) {
    if (off + 2 > raw.length) throw new Error('site-state archive truncated at entry header');
    const nameLen = raw.readUInt16LE(off);
    off += 2;
    if (off + nameLen + 4 > raw.length) throw new Error('site-state archive truncated at path');
    const rel = raw.subarray(off, off + nameLen).toString('utf8');
    off += nameLen;
    const dataLen = raw.readUInt32LE(off);
    off += 4;
    if (off + dataLen > raw.length) throw new Error('site-state archive truncated at data');
    out.push({ rel, data: raw.subarray(off, off + dataLen) });
    off += dataLen;
  }
  return out;
}

/**
 * Build the archive for the requested profiles (all live profiles when `profileIds` is null).
 *
 * Running profiles are skipped rather than read: reading a live LevelDB gives a torn copy, and the
 * operator gets a truthful list of what was left out instead of a silently broken restore.
 */
export function buildProfileArchive(
  profileIds: string[] | null,
  siteStateOnly: boolean
): { blob: Buffer; fileCount: number; excluded: string[]; skipped: Array<{ profileId: string; reason: string }> } {
  const targets = profileIds && profileIds.length > 0
    ? profileIds
    : listProfiles(1, Number.MAX_SAFE_INTEGER).list.map((p) => p.user_id);

  const entries: Array<{ rel: string; data: Buffer }> = [];
  const excluded: string[] = [];
  const skipped: Array<{ profileId: string; reason: string }> = [];

  for (const id of targets) {
    if (isRunning(id)) {
      skipped.push({ profileId: id, reason: 'running' });
      continue;
    }
    const dir = resolveProfileDir(id);
    if (!fs.existsSync(dir)) {
      skipped.push({ profileId: id, reason: 'no directory on disk' });
      continue;
    }
    const { files, excluded: ex } = collectProfileFiles(dir, siteStateOnly);
    excluded.push(...ex.map((e) => `${id}/${e}`));
    for (const f of files) {
      try {
        entries.push({ rel: `${id}/${f.rel}`, data: fs.readFileSync(f.abs) });
      } catch {
        // A file that disappears between the walk and the read is not a reason to fail the whole
        // archive — Chromium churns small files even when the profile is stopped.
      }
    }
  }

  return { blob: frameFiles(entries), fileCount: entries.length, excluded, skipped };
}

/**
 * Restore an archive onto this machine.
 *
 * Files are written with their relative paths recreated, so a profile directory that does not exist
 * yet is created. The caller is responsible for having imported the database rows first — profile
 * metadata and directory contents must land together or the profile opens empty.
 */
export function restoreProfileArchive(blob: Buffer): { restoredProfiles: number; fileCount: number } {
  const entries = unframeFiles(blob);
  const profiles = new Set<string>();
  let written = 0;

  for (const e of entries) {
    // Reject anything that tries to escape the profile root. An archive is untrusted input: a
    // `..` segment would otherwise let a tampered Drive file write anywhere on disk.
    const rel = e.rel.replace(/\\/g, '/');
    if (rel.split('/').some((seg) => seg === '..' || seg === '')) continue;
    const profileId = rel.split('/')[0];
    if (!profileId) continue;

    const dir = resolveProfileDir(profileId);
    const target = path.join(dir, ...rel.split('/').slice(1));
    if (!target.startsWith(dir)) continue;

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
    profiles.add(profileId);
    written += 1;
  }

  return { restoredProfiles: profiles.size, fileCount: written };
}
