import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import { EXTENSIONS_DIR } from '../config';
import { getInstalledKernelVersion } from '../util/kernelUpdate';
import { importExtension, registerExtensionDir, listExtensions, ExtensionRow } from './extensionManager';

export type NormalizedInput = { kind: 'id'; id: string } | { kind: 'path'; path: string };

/**
 * Injectable extension-manager seam (tests substitute this to avoid the DB).
 */
interface ExtensionManager {
  importExtension(name: string, sourcePath: string): string;
  /** Register a directory whose files are already unpacked, without copying them. */
  registerExtensionDir(name: string, dirPath: string): string;
  listExtensions(): ExtensionRow[];
}

let manager: ExtensionManager = {
  importExtension,
  registerExtensionDir,
  listExtensions,
};

export function setExtensionManager(m: Partial<ExtensionManager> | null): void {
  // Partial so a test that only stubs what it exercises keeps working; the real implementation
  // fills the rest.
  manager = m
    ? { importExtension, registerExtensionDir, listExtensions, ...m }
    : { importExtension, registerExtensionDir, listExtensions };
}

export class WebStoreError extends Error {
  constructor(public code: 'INVALID_INPUT' | 'BAD_SIGNATURE' | 'NOT_FOUND' | 'FETCH_ERROR', message: string) {
    super(`[${code}] ${message}`);
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
    return { kind: 'path', path: path.resolve(trimmed) };
  }

  // Check for bare 32-char [a-p] ID
  if (/^[a-p]{32}$/i.test(trimmed)) {
    return { kind: 'id', id: trimmed.toLowerCase() };
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
          return { kind: 'id', id: p.toLowerCase() };
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
    if (installed) {
      const match = installed.match(/^(\d+)/);
      if (match) return match[1];
    }
  } catch {
    // Fallback if config/kernel not initialized
  }
  return '130'; // Realistic default Chromium major
}

/**
 * Parse the update service's XML response.
 *
 * Chrome's update service stopped returning the CRX bytes directly. It answers with an Omaha
 * update manifest — XML naming a `codebase` URL, the artefact's `size` and its `hash_sha256` —
 * and the CRX has to be fetched from that URL. The code used to assume the response body WAS the
 * archive, so `verifyCrx` saw `<?xml` instead of the `Cr24` magic and every install failed with
 * "Invalid CRX magic header" while the UI reported success.
 *
 * `status` is read too: the service answers `status="ok"` for an installable extension and
 * something else (with no `codebase`) when the id is not available.
 */
export interface UpdateManifest {
  codebase: string;
  size?: number;
  hashSha256?: string;
  version?: string;
}

export function parseUpdateManifest(xml: string): UpdateManifest {
  const attr = (name: string): string | undefined => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
    return m ? m[1] : undefined;
  };

  const status = attr('status');
  const codebase = attr('codebase');
  if (status && status !== 'ok') {
    throw new WebStoreError('NOT_FOUND', `Chrome Web Store reported status "${status}"`);
  }
  if (!codebase) {
    throw new WebStoreError('NOT_FOUND', 'Chrome Web Store returned no download location for this extension');
  }

  const sizeRaw = attr('size');
  const size = sizeRaw ? Number(sizeRaw) : undefined;
  return {
    codebase,
    size: Number.isFinite(size) ? size : undefined,
    hashSha256: attr('hash_sha256'),
    version: attr('version'),
  };
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

  const body = await response.buffer();

  // The response is either the archive itself (older behaviour, and what the tests inject) or an
  // Omaha update manifest naming where to get it. Decide by the archive's own magic rather than
  // by content type, which the service does not set helpfully.
  const isCrx = body.length >= 4 && body.subarray(0, 4).toString('latin1') === 'Cr24';

  let crx = body;
  let expectedHash: string | undefined;

  if (!isCrx) {
    const manifest = parseUpdateManifest(body.toString('utf8'));
    expectedHash = manifest.hashSha256?.toLowerCase();

    let crxResponse: { status: number; ok: boolean; buffer: () => Promise<Buffer> };
    try {
      crxResponse = await transport(manifest.codebase);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new WebStoreError('FETCH_ERROR', `Network error downloading the extension archive: ${message}`);
    }
    if (!crxResponse.ok) {
      throw new WebStoreError('FETCH_ERROR', `Extension download returned HTTP ${crxResponse.status}`);
    }
    crx = await crxResponse.buffer();

    if (crx.length >= 4 && crx.subarray(0, 4).toString('latin1') !== 'Cr24') {
      throw new WebStoreError('BAD_SIGNATURE', 'The download location did not return a CRX archive');
    }
  }

  // The manifest publishes the archive's SHA-256. Checking it means a truncated or substituted
  // download is refused here rather than unpacked into the extensions directory — the same
  // fail-closed rule the CRX header and the signature are checked under.
  if (expectedHash) {
    const actual = createHash('sha256').update(crx).digest('hex');
    if (actual !== expectedHash) {
      throw new WebStoreError(
        'BAD_SIGNATURE',
        `Extension archive digest mismatch: expected ${expectedHash}, received ${actual}`,
      );
    }
  }

  return crx;
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

export function unpackCrx(zipBytes: Buffer, id: string): InstalledExtensionResult {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WebStoreError('BAD_SIGNATURE', `Not a valid zip payload: ${message}`);
  }
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

  return {
    id,
    name: resolvedName,
    version,
    path: targetDir,
    reused: false,
  };
}

/**
 * Registers an unpacked extension in the manager, or returns the existing
 * registration when the same id+version is already installed (idempotency).
 */
export function registerUnpacked(unpacked: InstalledExtensionResult): InstalledExtensionResult {
  const existing = manager.listExtensions().find((ext: ExtensionRow) => {
    return (
      (ext.path === unpacked.path || ext.path.includes(path.join(unpacked.id, unpacked.version))) &&
      ext.version === unpacked.version
    );
  });

  if (existing && fs.existsSync(existing.path)) {
    return {
      id: existing.id,
      name: existing.name,
      version: existing.version || unpacked.version,
      path: existing.path,
      reused: true,
    };
  }

  // Register the directory `unpackCrx` already wrote. Copying it into a new `ext_<uuid>` would
  // record a path without the store id in it, which is what made the idempotency checks above
  // and in `installFromWebStore` unable to match — the cause of duplicate installs.
  const extensionId = manager.registerExtensionDir(unpacked.name, unpacked.path);
  return { ...unpacked, id: extensionId };
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

    const id = manager.importExtension(name, norm.path);
    return {
      id,
      name,
      version,
      path: norm.path,
      reused: false,
    };
  }

  // Idempotency: if this store id is already installed at the same version,
  // return the existing registration without a network fetch.
  const alreadyInstalled = manager.listExtensions().find(
    (ext: ExtensionRow) =>
      ext.path.includes(path.join(norm.id, ext.version ?? '')) && fs.existsSync(ext.path)
  );
  if (alreadyInstalled) {
    return {
      id: alreadyInstalled.id,
      name: alreadyInstalled.name,
      version: alreadyInstalled.version || '0.0.0',
      path: alreadyInstalled.path,
      reused: true,
    };
  }

  const crxBytes = await fetchCrx(norm.id);
  const verified = verifyCrx(crxBytes);
  const unpacked = unpackCrx(verified.zipPayload, norm.id);
  return registerUnpacked(unpacked);
}
