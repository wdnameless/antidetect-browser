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
 * Whether the operator has already answered "where should data live?" on a
 * portable launch. When they have not, the UI asks once and persists the answer.
 */
export function needsDataModeChoice(): boolean {
  if (!isPortableMode()) return false;
  const mode = readSettings().dataMode;
  return mode !== 'portable' && mode !== 'system';
}

/** Persist the portable data-location choice. Takes effect on next start. */
export function setDataMode(mode: 'portable' | 'system'): void {
  const s = readSettings();
  s.dataMode = mode;
  writeSettings(s);
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
  if (process.resourcesPath) {
    dirs.push(path.join(process.resourcesPath, 'kernel', 'fingerprint-chromium'));
  }
  dirs.push(path.join(CHROMIUM_DIR, 'fingerprint-chromium'));
  return dirs;
}

/**
 * Locate the patched fingerprint-chromium executable.
 * Priority: CHROMIUM_PATH env -> packaged resources (process.resourcesPath/kernel) -> data dir.
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
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'chromedriver', 'chromedriver.exe'));
  candidates.push(path.join(CHROMEDRIVER_DIR, 'chromedriver.exe'));
  candidates.push(path.join(CHROMEDRIVER_DIR, 'chromedriver-win64', 'chromedriver.exe'));
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}
