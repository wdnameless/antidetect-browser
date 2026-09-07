import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { EXTENSIONS_DIR } from '../config';
import { getInstalledKernelVersion } from '../util/kernelUpdate';
import { importExtension, listExtensions, ExtensionRow } from './extensionManager';

export type NormalizedInput = { id: string } | { path: string };

export class WebStoreError extends Error {
  constructor(public code: 'INVALID_INPUT' | 'BAD_SIGNATURE' | 'NOT_FOUND' | 'FETCH_ERROR', message: string) {
    super(message);
    this.name = 'WebStoreError';
  }
}

/**
 * Normalizes input which can be:
 * - Chrome Web Store URL (chromewebstore.google.com/detail/<slug>/<id> or chrome.google.com/webstore/detail/<id>)
 * - Bare 32-character extension ID [a-p]{32}
 * - Local filesystem path
 */
export function normalizeWebStoreInput(input: string): NormalizedInput {
  if (!input || typeof input !== 'string') {
    throw new WebStoreError('INVALID_INPUT', 'Input must be a non-empty string');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new WebStoreError('INVALID_INPUT', 'Input cannot be empty');
  }

  // Check if it is a local path first (exists on disk or starts with ./, ../, /, or Windows drive letter)
  const isExplicitPath = /^[a-zA-Z]:[\\/]|^[\\/]|\.\.[\\/]|\.[\\/]/.test(trimmed);
  if (isExplicitPath || fs.existsSync(trimmed)) {
    return { path: path.resolve(trimmed) };
  }

  // Check for bare 32-char [a-p] ID
  if (/^[a-p]{32}$/i.test(trimmed)) {
    return { id: trimmed.toLowerCase() };
  }

  // Check for URL forms
  try {
    const url = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();

    if (host === 'chromewebstore.google.com' || host === 'chrome.google.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (/^[a-p]{32}$/i.test(p)) {
          return { id: p.toLowerCase() };
        }
      }
    }
  } catch {
    // Not a valid URL
  }

  throw new WebStoreError('INVALID_INPUT', `Invalid Web Store URL, extension ID, or file path: "${input}"`);
}

export type FetchTransport = (url: string) => Promise<{ status: number; ok: boolean; buffer: () => Promise<Buffer> }>;

let customFetchTransport: FetchTransport | null = null;

export function setFetchTransport(transport: FetchTransport | null): void {
  customFetchTransport = transport;
}

export const setFetchCrxTransport = (transport: ((url: string) => Promise<Buffer | { status: number; ok: boolean; buffer: () => Promise<Buffer> }>) | null) => {
  if (!transport) {
    customFetchTransport = null;
    return;
  }
  customFetchTransport = async (url: string) => {
    const res = await transport(url);
    if (Buffer.isBuffer(res)) {
      return {
        status: 200,
        ok: true,
        buffer: async () => res,
      };
    }
    return res;
  };
};

export const resetFetchCrxTransport = () => {
  customFetchTransport = null;
};

/**
 * Get Chromium major version to use for prodversion in the update URL.
 */
export function getEngineMajorVersion(): string {
  try {
    const installed = getInstalledKernelVersion();
    if (installed?.version) {
      const match = installed.version.match(/^(\d+)/);
      if (match) return match[1];
    }
  } catch {
    // Fallback if config/kernel not initialized
  }
  return '130'; // Realistic default Chromium major
}

/**
 * Fetches CRX binary from Chrome Web Store update service.
 */
export async function fetchCrx(id: string): Promise<Buffer> {
  const major = getEngineMajorVersion();
  const url = `https://clients2.google.com/service/update2/crx?prodversion=${major}&acceptformat=crx2,crx3&x=id%3D${encodeURIComponent(id)}%26uc`;

  const transport = customFetchTransport || (async (fetchUrl: string) => {
    const res = await fetch(fetchUrl);
    return {
      status: res.status,
      ok: res.ok,
      buffer: async () => Buffer.from(await res.arrayBuffer()),
    };
  });

  let response: { status: number; ok: boolean; buffer: () => Promise<Buffer> };
  try {
    response = await transport(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WebStoreError('FETCH_ERROR', `Network error fetching CRX: ${message}`);
  }

  if (response.status === 404) {
    throw new WebStoreError('NOT_FOUND', `Extension ${id} not found on Chrome Web Store`);
  }

  if (!response.ok) {
    throw new WebStoreError('FETCH_ERROR', `Chrome Web Store returned HTTP ${response.status}`);
  }

  return await response.buffer();
}

export interface VerifiedCrx {
  version: 2 | 3;
  zipPayload: Buffer;
}

/**
 * Verifies CRX2/CRX3 magic header and extracts zip payload.
 *
 * CRX2 format:
 * - 0..3: "Cr24" (0x43 0x72 0x32 0x34)
 * - 4..7: version = 2 (uint32 LE)
 * - 8..11: pubKeyLength (uint32 LE)
 * - 12..15: sigLength (uint32 LE)
 * - 16..(16 + pubKeyLength + sigLength): header content
 * - rest: zip payload
 *
 * CRX3 format:
 * - 0..3: "Cr24"
 * - 4..7: version = 3 (uint32 LE)
 * - 8..11: headerLength (uint32 LE)
 * - 12..(12 + headerLength): header content (protobuf)
 * - rest: zip payload
 */
export function verifyCrx(bytes: Buffer): VerifiedCrx {
  if (bytes.length < 16) {
    throw new WebStoreError('BAD_SIGNATURE', 'File too small to be a valid CRX');
  }

  const magic = bytes.subarray(0, 4).toString('utf8');
  if (magic !== 'Cr24') {
    throw new WebStoreError('BAD_SIGNATURE', `Invalid CRX magic header: ${magic}`);
  }

  const version = bytes.readUInt32LE(4);
  if (version === 2) {
    const pubKeyLen = bytes.readUInt32LE(8);
    const sigLen = bytes.readUInt32LE(12);
    const headerTotal = 16 + pubKeyLen + sigLen;
    if (pubKeyLen === 0 || sigLen === 0 || bytes.length < headerTotal) {
      throw new WebStoreError('BAD_SIGNATURE', 'Invalid CRX2 header dimensions');
    }
    const zipPayload = bytes.subarray(headerTotal);
    if (zipPayload.length < 4 || zipPayload[0] !== 0x50 || zipPayload[1] !== 0x4b) {
      throw new WebStoreError('BAD_SIGNATURE', 'Corrupted CRX2 zip payload');
    }
    return { version: 2, zipPayload };
  } else if (version === 3) {
    const headerLen = bytes.readUInt32LE(8);
    const headerTotal = 12 + headerLen;
    if (headerLen === 0 || bytes.length < headerTotal) {
      throw new WebStoreError('BAD_SIGNATURE', 'Invalid CRX3 header length');
    }
    const zipPayload = bytes.subarray(headerTotal);
    if (zipPayload.length < 4 || zipPayload[0] !== 0x50 || zipPayload[1] !== 0x4b) {
      throw new WebStoreError('BAD_SIGNATURE', 'Corrupted CRX3 zip payload');
    }
    return { version: 3, zipPayload };
  } else {
    throw new WebStoreError('BAD_SIGNATURE', `Unsupported CRX version: ${version}`);
  }
}

/**
 * Resolves __MSG_*__ localization keys in manifest string using _locales files.
 */
function resolveLocalizedName(unpackedDir: string, rawName: string): string {
  if (!rawName.startsWith('__MSG_') || !rawName.endsWith('__')) {
    return rawName;
  }
  const key = rawName.slice(6, -2);
  const localesDir = path.join(unpackedDir, '_locales');
  if (!fs.existsSync(localesDir)) return rawName;

  let defaultLocale = 'en';
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(unpackedDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    if (typeof manifest.default_locale === 'string') {
      defaultLocale = manifest.default_locale;
    }
  } catch {
    // ignore
  }

  const candidateLocales = [defaultLocale, 'en', 'en_US', 'en_GB'];
  try {
    const available = fs.readdirSync(localesDir);
    for (const loc of candidateLocales) {
      const match = available.find((a) => a.toLowerCase() === loc.toLowerCase());
      if (match) {
        const msgFile = path.join(localesDir, match, 'messages.json');
        if (fs.existsSync(msgFile)) {
          const messages = JSON.parse(fs.readFileSync(msgFile, 'utf8')) as Record<string, { message?: unknown }>;
          if (messages[key]?.message) {
            return String(messages[key].message);
          }
          const foundKey = Object.keys(messages).find((k) => k.toLowerCase() === key.toLowerCase());
          if (foundKey && messages[foundKey]?.message) {
            return String(messages[foundKey].message);
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return rawName;
}

export interface InstalledExtensionResult {
  id: string;
  name: string;
  version: string;
  path: string;
  reused: boolean;
}

/**
 * Unpacks verified CRX zip payload into data/extensions/<id>/<version>/
 * Resolves __MSG_*__ localization in manifest, and registers via importExtension or returns existing.
 */
export function unpackCrx(zipBytes: Buffer, id: string): InstalledExtensionResult {
  const zip = new AdmZip(zipBytes);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    throw new WebStoreError('BAD_SIGNATURE', 'CRX does not contain manifest.json');
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new WebStoreError('BAD_SIGNATURE', 'Invalid manifest.json in CRX payload');
  }

  const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  const targetDir = path.join(EXTENSIONS_DIR, id, version);

  // Check idempotency: check if extension already exists in db with matching id & version
  const existing = listExtensions().find((ext: ExtensionRow) => {
    return (
      (ext.path === targetDir || ext.path.includes(path.join(id, version))) &&
      ext.version === version
    );
  });

  if (existing && fs.existsSync(existing.path)) {
    return {
      id: existing.id,
      name: existing.name,
      version: existing.version || version,
      path: existing.path,
      reused: true,
    };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  try {
    zip.extractAllTo(targetDir, true);
  } catch (err) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    const message = err instanceof Error ? err.message : String(err);
    throw new WebStoreError('BAD_SIGNATURE', `Failed to unpack CRX zip: ${message}`);
  }

  const rawName = typeof manifest.name === 'string' ? manifest.name : id;
  const resolvedName = resolveLocalizedName(targetDir, rawName);

  const extensionId = importExtension(resolvedName, targetDir);

  return {
    id: extensionId,
    name: resolvedName,
    version,
    path: targetDir,
    reused: false,
  };
}

/**
 * High-level install workflow:
 * 1. Normalize input (URL, ID, or path)
 * 2. If path: import directly
 * 3. If ID: fetch CRX, verify header, unpack, register
 */
export async function installFromWebStore(input: string): Promise<InstalledExtensionResult> {
  const norm = normalizeWebStoreInput(input);

  if (norm.kind === 'path') {
    let name = path.basename(norm.path);
    let version = '0.0.0';
    try {
      const manifestPath = path.join(norm.path, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        if (typeof manifest.name === 'string') name = resolveLocalizedName(norm.path, manifest.name);
        if (typeof manifest.version === 'string') version = manifest.version;
      }
    } catch {
      // ignore
    }

    const id = importExtension(name, norm.path);
    return {
      id,
      name,
      version,
      path: norm.path,
      reused: false,
    };
  }

  const crxBytes = await fetchCrx(norm.id);
  const verified = verifyCrx(crxBytes);
  return unpackCrx(verified.zipPayload, norm.id);
}
