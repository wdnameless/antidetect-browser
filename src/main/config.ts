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
  return path.join(os.homedir(), '.antidetect');
}

function settingsFile(): string {
  return path.join(settingsBase(), 'settings.json');
}

function readSettings(): Record<string, unknown> {
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

function resolveDataDir(): string {
  // 1) Explicit env override (used by tests and CI).
  if (process.env.ANTIDETECT_DATA_DIR && process.env.ANTIDETECT_DATA_DIR.length > 0) {
    return process.env.ANTIDETECT_DATA_DIR;
  }
  // 2) User-chosen directory persisted in settings.json.
  const saved = readSettings().dataDir;
  if (typeof saved === 'string' && saved.length > 0) {
    return saved;
  }
  // 3) Default: <settingsBase>/data (writable, stable across updates).
  return path.join(settingsBase(), 'data');
}

export const DATA_DIR = resolveDataDir();
export const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
export const CHROMIUM_DIR = path.join(DATA_DIR, 'chromium');
export const CHROMEDRIVER_DIR = path.join(DATA_DIR, 'chromedriver');
export const EXTENSIONS_DIR = path.join(DATA_DIR, 'extensions');
export const DB_PATH = path.join(DATA_DIR, 'antidetect.db');

export const API_HOST = '127.0.0.1';
export const API_PORT = Number(process.env.API_PORT || 50325);

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

  // Packaged app: kernel shipped inside resources/kernel (extraResources).
  if (process.resourcesPath) {
    const packaged = scan(path.join(process.resourcesPath, 'kernel', 'fingerprint-chromium'));
    if (packaged) return packaged;
  }

  return scan(path.join(CHROMIUM_DIR, 'fingerprint-chromium'));
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
