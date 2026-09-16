import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';

// Base directory for app settings (settings.json). Electron sets ANTIDETECT_SETTINGS_DIR
// to app.getPath('userData'); standalone service falls back to ~/.antidetect.
function settingsBase(): string {
  if (process.env.ANTIDETECT_SETTINGS_DIR && process.env.ANTIDETECT_SETTINGS_DIR.length > 0) {
    return process.env.ANTIDETECT_SETTINGS_DIR;
  }
  // KEEP: Preserves existing install directory location ~/.antidetect across updates.
  return path.join(os.homedir(), '.antidetect');
}

function settingsFile(): string {
  return path.join(settingsBase(), 'settings.json');
}

export function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(s: Record<string, unknown>): void {
  try {
    fs.mkdirSync(settingsBase(), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8');
  } catch {
    // ignore — settings are best-effort
  }
}

/**
 * True when running from the installer-free portable artefact.
 *
 * electron-builder's `portable` target self-extracts and exports
 * PORTABLE_EXECUTABLE_DIR pointing at the directory the user actually ran the
 * .exe from. A portable copy must resolve its data relative to THAT directory,
 * never to an absolute path captured on first run — otherwise moving the folder
 * to another machine or drive breaks it, which is the whole point of portable.
 */
export function isPortableMode(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR && process.env.PORTABLE_EXECUTABLE_DIR.length > 0);
}

/** Directory the portable executable was launched from, or null when not portable. */
export function portableBaseDir(): string | null {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR;
  return dir && dir.length > 0 ? dir : null;
}

/**
 * Resolve the data directory from the current environment and settings.
 *
 * Exported so the resolution order (env → saved choice → portable → system
 * default) can be exercised directly: `DATA_DIR` is a module-level constant, so
 * testing the order through it would need a module reload per case.
 */
export function resolveDataDir(): string {
  // 1) Explicit env override (used by tests and CI).
  if (process.env.ANTIDETECT_DATA_DIR && process.env.ANTIDETECT_DATA_DIR.length > 0) {
    return process.env.ANTIDETECT_DATA_DIR;
  }
  const settings = readSettings();
  // 2) User-chosen directory persisted in settings.json.
  const saved = settings.dataDir;
  if (typeof saved === 'string' && saved.length > 0) {
    return saved;
  }
  // 3) Portable mode: data beside the executable so the folder can be moved whole.
  //    Honours an explicit 'system' choice, which falls through to the default below.
  if (isPortableMode() && settings.dataMode !== 'system') {
    return path.join(portableBaseDir() as string, 'data');
  }
  // 4) Default: <settingsBase>/data (writable, stable across updates).
  return path.join(settingsBase(), 'data');
}

/**
 * Whether this launch should ask the operator where to keep its data.
 *
 * This is the first-run prompt, and it applies to EVERY build, not just the portable one:
 * an installed app puts profiles, the database, the browser kernel and downloaded
 * extensions under the user profile, which may be on a small system drive. The operator gets
 * to choose once, and the answer is honoured from then on.
 *
 * It deliberately returns false wherever the location is imposed rather than chosen:
 *   - `ANTIDETECT_DATA_DIR` was set from outside — CI, tests and managed deployments pin the
 *     path. The desktop shell also exports this variable, but only so the sidecar agrees with
 *     the path the shell resolved; it marks that export with
 *     `ANTIDETECT_DATA_DIR_FROM_SHELL`, which keeps a first run on the desktop prompting
 *     instead of silently resolving to the default;
 *   - server mode — a headless deployment has no one to click, and its paths come from the
 *     environment;
 *   - a directory or a mode was already recorded — never re-ask;
 *   - the current directory already holds profiles — an install upgraded from a version that
 *     never recorded a choice. Asking there would be an invitation to relocate away from
 *     existing profiles, which looks exactly like losing them.
 */
export function needsFirstRunDataChoice(): boolean {
  const shellExported = process.env.ANTIDETECT_DATA_DIR_FROM_SHELL === '1';
  const pinnedExternally =
    !shellExported && typeof process.env.ANTIDETECT_DATA_DIR === 'string' && process.env.ANTIDETECT_DATA_DIR.length > 0;
  if (pinnedExternally) return false;
  if (SERVER_MODE) return false;
  const s = readSettings();
  if (typeof s.dataDir === 'string' && s.dataDir.length > 0) return false;
  if (s.dataMode === 'portable' || s.dataMode === 'system') return false;
  // Existing data is itself proof that the location is settled. Without this an upgrade from
  // a build that predates the prompt would ask a user with hundreds of profiles to start
  // fresh, and the obvious answer — "pick a new folder" — would open an empty library.
  //
  // The marker must be something only real use can produce. `config.ts` eagerly creates the
  // data dir, `profiles/`, `chromium/` and an empty database at import, so their mere
  // existence proves nothing — an earlier revision checked the folders themselves and the
  // prompt never fired. A NON-EMPTY profiles directory is the reliable signal: profile
  // folders are only created when the operator actually runs a profile. An installed kernel
  // is deliberately NOT used — a dev checkout leaves an empty `chromium/fingerprint-chromium`
  // symlink, which would silently suppress the prompt on a fresh install.
  const target = resolveDataDir();
  if (hasProfileData(path.join(target, 'profiles'))) return false;
  return true;
}

/** True when `profilesDir` holds at least one entry, i.e. the app has been used for real. */
function hasProfileData(profilesDir: string): boolean {
  try {
    return fs.readdirSync(profilesDir).length > 0;
  } catch {
    return false;
  }
}

/**
 * The directory that would be used if the operator accepts the default.
 *
 * Shown in the first-run prompt and used when they press "Use this folder" without picking
 * anything, so the UI can state the actual path instead of describing it vaguely.
 */
export function defaultDataDir(): string {
  if (isPortableMode()) return path.join(portableBaseDir() as string, 'data');
  return path.join(settingsBase(), 'data');
}

/**
 * Persist the first-run choice and report whether it was actually written.
 *
 * A concrete `dir` is stored under `dataDir` — the same key the resolver reads and Settings
 * writes — and a `mode` records one of the two well-known layouts, clearing any earlier
 * explicit path because a stale path would otherwise silently outrank the mode the operator
 * just picked. Takes effect on the next start: `DATA_DIR` is resolved once at import time.
 */
export function setFirstRunDataChoice(choice: { dir?: string | null; mode?: 'portable' | 'system' }): { ok: boolean; error?: string } {
  if (choice.dir && choice.dir.trim().length > 0) {
    const s = readSettings();
    s.dataDir = path.resolve(choice.dir.trim());
    return tryWriteSettings(s);
  }
  if (choice.mode === 'portable' || choice.mode === 'system') {
    const s = readSettings();
    s.dataMode = choice.mode;
    delete s.dataDir;
    return tryWriteSettings(s);
  }
  return { ok: false, error: 'either dir or mode is required' };
}

/**
 * True when the directory can actually hold the data: it exists or can be created, and is
 * writable. A prompt that accepts an unwritable path (Program Files, a read-only share)
 * would fail later with an opaque database error instead of at the moment of choosing.
 *
 * `create: false` answers the question WITHOUT touching the filesystem. The prompt checks a
 * path on every blur while the operator is still typing, so the default must not create
 * anything — an earlier revision did, and merely typing `…/settings.json` created a
 * directory with that name, which then broke writing the real settings file.
 */
export function isUsableDataDir(dir: string, opts: { create?: boolean } = {}): { ok: boolean; error?: string } {
  const create = opts.create !== false;
  if (create) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { ok: false, error: `cannot create folder: ${(err as Error).message}` };
    }
  } else if (!fs.existsSync(dir)) {
    // Does not exist yet: judge the nearest existing ancestor, since that is what a later
    // create would have to write into.
    let probe = path.dirname(path.resolve(dir));
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    try {
      fs.accessSync(probe, fs.constants.W_OK);
    } catch {
      return { ok: false, error: 'folder cannot be created there (parent is not writable)' };
    }
    return { ok: true };
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return { ok: false, error: 'folder is not writable' };
  }
  if (!fs.statSync(dir).isDirectory()) {
    return { ok: false, error: 'a file already exists at this path' };
  }
  return { ok: true };
}

/**
 * True when `dir` would collide with the app's own settings file.
 *
 * A directory at `settings.json` cannot be written to, so choosing that path would break
 * settings permanently — including the record of the choice itself, which is why it must be
 * refused rather than accepted and then reported as an unwritable file later.
 */
export function dataDirCollidesWithSettings(dir: string): boolean {
  const resolved = path.resolve(dir);
  if (resolved === path.resolve(settingsFile())) return true;
  // Also refuse a parent that would swallow the settings directory, e.g. choosing the
  // user profile itself puts data next to unrelated files and is almost always a misclick.
  const base = path.resolve(settingsBase());
  return base.startsWith(resolved + path.sep);
}

/**
 * Persists settings and reports whether it worked.
 *
 * `writeSettings` intentionally swallows failures — settings are best-effort and must never
 * take the service down. But a FIRST-RUN choice is not best-effort: reporting success while
 * the file was never written sends the operator into a restart that silently resolves to the
 * default folder, which looks identical to the choice being ignored.
 */
export function tryWriteSettings(s: Record<string, unknown>): { ok: boolean; error?: string } {
  try {
    fs.mkdirSync(settingsBase(), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// KEEP: Preserves existing data directory location across updates.
export const DATA_DIR = resolveDataDir();
export const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
export const CHROMIUM_DIR = path.join(DATA_DIR, 'chromium');
export const CHROMEDRIVER_DIR = path.join(DATA_DIR, 'chromedriver');
export const EXTENSIONS_DIR = path.join(DATA_DIR, 'extensions');
// KEEP: Preserves existing database filename antidetect.db.
export const DB_PATH = path.join(DATA_DIR, 'antidetect.db');

export const API_HOST = process.env.API_HOST || '127.0.0.1';
export const API_PORT = Number(process.env.API_PORT || 50325);

/**
 * The running application version, read from package.json.
 *
 * Resolved by walking up from this file so it works both compiled (`dist/src/main`) and
 * from source, and falls back to a clearly-unknown marker rather than a plausible-looking
 * number: a health endpoint that reports a version it invented is worse than one that
 * admits it does not know.
 */
export const APP_VERSION: string = (() => {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: string };
      if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'unknown';
})();

/**
 * Server mode: the service is deployed on a remote machine and reached through
 * a reverse proxy (Traefik) over VPN. Enables trusted non-loopback Host headers,
 * disables permissive CORS and enables request logging to DATA_DIR/server.log.
 */
export const SERVER_MODE = process.env.ANTIDETECT_SERVER_MODE === '1';

/** Extra Host headers accepted in server mode (comma-separated, host only). */
export const TRUSTED_HOSTS: string[] = (process.env.ANTIDETECT_TRUSTED_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter((h) => h.length > 0);

const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** True when the request arrived through a public/trusted entry point. */
export function isRemoteHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const h = String(hostHeader);
  if (LOOPBACK_HOST_RE.test(h)) return false;
  if (!SERVER_MODE) return true;
  const bare = h.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  return TRUSTED_HOSTS.includes(bare);
}

for (const dir of [DATA_DIR, PROFILES_DIR, CHROMIUM_DIR, EXTENSIONS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Current data directory (profiles, kernel, extensions, DB). */
export function getDataDir(): string {
  return DATA_DIR;
}

/**
 * Persist a new data directory. The change takes effect after the app restarts
 * (the backend resolves DATA_DIR at import time). Returns the new path.
 */
export function setDataDir(dir: string): string {
  const s = readSettings();
  s.dataDir = dir;
  writeSettings(s);
  return dir;
}

/** Read a single persisted setting (settings.json). */
export function getSetting(key: string): unknown {
  return readSettings()[key];
}

/** Persist a single setting (takes effect immediately). */
export function setSetting(key: string, value: unknown): void {
  const s = readSettings();
  s[key] = value;
  writeSettings(s);
}

/**
 * Script catalog manifest URL (Sprint 4.4). Default stub ships empty so the
 * catalog starts disabled; users point it at their own GitHub raw manifest in
 * Settings. Env override wins for CI/server deployments.
 */
export const CATALOG_URL_DEFAULT = '';
export function getCatalogUrl(): string {
  const fromEnv = process.env.ANTIDETECT_CATALOG_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const saved = getSetting('catalogUrl');
  return typeof saved === 'string' ? saved : CATALOG_URL_DEFAULT;
}

let cachedApiKey: string | null = null;

export function getApiKey(): string {
  if (cachedApiKey) return cachedApiKey;
  const keyFile = path.join(DATA_DIR, 'api_key');
  if (fs.existsSync(keyFile)) {
    cachedApiKey = fs.readFileSync(keyFile, 'utf8').trim();
  } else {
    cachedApiKey = randomUUID();
    fs.writeFileSync(keyFile, cachedApiKey, 'utf8');
  }
  return cachedApiKey;
}
/**
 * In Tauri mode the host injects ANTIDETECT_TARGET_RESOURCES_DIR so the
 * backend resolves bundled resources without referencing `process.resourcesPath`.
 * Returns null when unset or empty.
 */
export function targetResourcesDir(): string | null {
  const dir = process.env.ANTIDETECT_TARGET_RESOURCES_DIR?.trim();
  return dir && dir.length > 0 ? dir : null;
}

/**
 * Directories that may hold the fingerprint-chromium kernel, in priority order:
 * a packaged build ships it under resources/kernel, a dev/portable run keeps it
 * under the data dir.
 *
 * Exported so the executable lookup and the version report read the SAME list —
 * they previously disagreed, and a packaged app therefore launched fine while
 * Settings reported the kernel as missing.
 */
export function kernelBaseDirs(): string[] {
  const dirs: string[] = [];
  // Packaged app: kernel shipped inside resources/kernel (extraResources).
  const resDir = targetResourcesDir();
  if (resDir) {
    dirs.push(path.join(resDir, 'kernel', 'fingerprint-chromium'));
  }
  dirs.push(path.join(CHROMIUM_DIR, 'fingerprint-chromium'));
  return dirs;
}

/**
 * Locate the patched fingerprint-chromium executable.
 * Priority: CHROMIUM_PATH env -> packaged resources (targetResourcesDir/kernel) -> data dir.
 */
function findFingerprintChromium(): string | null {
  const scan = (base: string): string | null => {
    try {
      if (!fs.existsSync(base)) return null;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const candidate = path.join(base, entry.name, 'chrome.exe');
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // ignore
    }
    return null;
  };

  for (const base of kernelBaseDirs()) {
    const found = scan(base);
    if (found) return found;
  }
  return null;
}

/**
 * Locate the Camoufox (Firefox) executable under data/chromium/camoufox/extracted/camoufox.exe.
 */
function findCamoufox(): string | null {
  const candidate = path.join(CHROMIUM_DIR, 'camoufox', 'extracted', 'camoufox.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Resolve a Chromium/Chrome executable.
 * Priority: CHROMIUM_PATH env -> fingerprint-chromium build -> other builds under data/chromium
 * -> common system paths -> PATH.
 */
export function getChromiumPath(): string {
  if (process.env.CHROMIUM_PATH && process.env.CHROMIUM_PATH.length > 0) {
    return process.env.CHROMIUM_PATH;
  }

  const fingerprintKernel = findFingerprintChromium();
  if (fingerprintKernel) return fingerprintKernel;

  const candidates: string[] = [];

  try {
    const scan = (dir: string, depth: number): void => {
      if (depth > 5 || !fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full, depth + 1);
        } else if (/^(chrome|chromium|chrome-headless-shell)\.exe$/i.test(entry.name)) {
          candidates.push(full);
        }
      }
    };
    scan(CHROMIUM_DIR, 0);
  } catch {
    // ignore scan errors
  }

  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData\\Local');
  candidates.push(path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'));
  candidates.push(path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'));
  candidates.push(path.join(local, 'Google\\Chrome\\Application\\chrome.exe'));

  const found = candidates.find((c) => fs.existsSync(c));
  if (found) return found;

  return 'chrome.exe';
}

/** Resolve the Camoufox (Firefox) executable, or null if not installed. */
export function getCamoufoxPath(): string | null {
  if (process.env.CAMOUFOX_PATH && process.env.CAMOUFOX_PATH.length > 0) {
    return process.env.CAMOUFOX_PATH;
  }
  return findCamoufox();
}

/**
 * Locate chromedriver matching the kernel (Chromium 148) for Selenium via debuggerAddress.
 * Priority: CHROMEDRIVER_PATH env -> packaged resources -> data/chromedriver. Null if absent.
 */
export function getChromedriverPath(): string | null {
  if (process.env.CHROMEDRIVER_PATH && process.env.CHROMEDRIVER_PATH.length > 0) {
    return process.env.CHROMEDRIVER_PATH;
  }
  const candidates: string[] = [];
  const resDir = targetResourcesDir();
  if (resDir) candidates.push(path.join(resDir, 'chromedriver', 'chromedriver.exe'));
  candidates.push(path.join(CHROMEDRIVER_DIR, 'chromedriver.exe'));
  candidates.push(path.join(CHROMEDRIVER_DIR, 'chromedriver-win64', 'chromedriver.exe'));
  return candidates.find((c) => fs.existsSync(c)) ?? null;

}
