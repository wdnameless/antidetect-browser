import { generateKeyPairSync, sign, verify, createHash, KeyObject } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { canonicalizeJson } from './jcs';

export interface KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface KeyRingEntry {
  keyId: string;
  publicKeyPem: string;
  revoked?: boolean;
  revokedAt?: string;
  revocationReason?: string;
  createdAt: string;
  comment?: string;
}

export interface KeyRing {
  version: number;
  keys: Record<string, KeyRingEntry>;
  defaultKeyId?: string;
}

export interface ManifestFileEntry {
  path: string;
  md5: string;
  size?: number;
}

export interface SignedManifestPayload {
  manifestVersion: string;
  version: string;
  createdAt: string;
  files: Record<string, string>; // path -> md5
  metadata?: Record<string, unknown>;
}

export interface SignedManifestEnvelope {
  payload: SignedManifestPayload;
  keyId: string;
  signature: string; // hex
}

export interface VerificationResult {
  valid: boolean;
  reason?: 'key-not-found' | 'key-revoked' | 'signature-mismatch' | 'digest-mismatch' | 'rollback-violation' | 'missing-file' | 'unsupported-version' | 'invalid-envelope' | 'ok';
  error?: string;
  checkedFiles?: string[];
  mismatchedFiles?: string[];
}

export const SIGNING_DOMAIN_PREFIX = 'antidetect:supply-chain:v1\0';

/**
 * Generate an Ed25519 keypair in SPKI / PKCS#8 PEM formats.
 */
export function generateEd25519KeyPair(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

/**
 * Calculate md5 digest of a Buffer or file.
 */
export function computeMd5(content: Buffer | string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Calculate md5 digest of a file on disk.
 */
export function computeFileMd5(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return computeMd5(buf);
}

/**
 * Compute file manifest (relative path -> md5) for a directory.
 */
export function buildDirectoryMd5Manifest(dirPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(current: string, rel: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      // normalize forward slashes
      const normalizedRel = relPath.replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(fullPath, normalizedRel);
      } else if (entry.isFile()) {
        result[normalizedRel] = computeFileMd5(fullPath);
      }
    }
  }
  if (fs.existsSync(dirPath)) {
    walk(dirPath, '');
  }
  return result;
}

/**
 * Sign arbitrary object payload using Ed25519 with JCS canonicalization and domain separation.
 */
export function signPayload(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  domain: string = SIGNING_DOMAIN_PREFIX
): string {
  const canonical = canonicalizeJson(payload);
  const message = Buffer.concat([Buffer.from(domain, 'utf8'), Buffer.from(canonical, 'utf8')]);
  return sign(null, message, privateKeyPem).toString('hex');
}

/**
 * Verify Ed25519 signature over arbitrary object payload with JCS canonicalization.
 */
export function verifyPayloadSignature(
  payload: Record<string, unknown>,
  signatureHex: string,
  publicKeyPem: string,
  domain: string = SIGNING_DOMAIN_PREFIX
): boolean {
  try {
    const canonical = canonicalizeJson(payload);
    const message = Buffer.concat([Buffer.from(domain, 'utf8'), Buffer.from(canonical, 'utf8')]);
    const sig = Buffer.from(signatureHex, 'hex');
    return verify(null, message, publicKeyPem, sig);
  } catch {
    return false;
  }
}

/**
 * Compare two semantic version strings or numeric version sequences monotonically.
 * Returns:
 *  > 0 if v1 > v2
 *  < 0 if v1 < v2
 *  0 if v1 === v2
 */
export function compareVersions(v1: string, v2: string): number {
  // Strip optional 'v' prefix
  const clean1 = v1.replace(/^v/i, '').trim();
  const clean2 = v2.replace(/^v/i, '').trim();

  const parts1 = clean1.split(/[\.-]/).map((p) => {
    const n = parseInt(p, 10);
    return isNaN(n) ? p : n;
  });
  const parts2 = clean2.split(/[\.-]/).map((p) => {
    const n = parseInt(p, 10);
    return isNaN(n) ? p : n;
  });

  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (typeof p1 === 'number' && typeof p2 === 'number') {
      if (p1 !== p2) return p1 - p2;
    } else {
      const str1 = String(p1);
      const str2 = String(p2);
      const cmp = str1.localeCompare(str2);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

/**
 * Create a signed manifest envelope for files and metadata.
 */
export function createSignedManifest(
  params: {
    version: string;
    files: Record<string, string>; // path -> md5
    keyId: string;
    privateKeyPem: string;
    manifestVersion?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }
): SignedManifestEnvelope {
  const payload: SignedManifestPayload = {
    manifestVersion: params.manifestVersion || '1.0.0',
    version: params.version,
    createdAt: params.createdAt || new Date().toISOString(),
    files: params.files,
    metadata: params.metadata,
  };

  const signature = signPayload(payload as unknown as Record<string, unknown>, params.privateKeyPem);

  return {
    payload,
    keyId: params.keyId,
    signature,
  };
}

/**
 * In-memory / file-based KeyRing store manager.
 */
export class KeyRingStore {
  private keyRing: KeyRing;
  private filePath?: string;

  constructor(initialKeyRing?: KeyRing, filePath?: string) {
    this.keyRing = initialKeyRing || { version: 1, keys: {} };
    this.filePath = filePath;
  }

  static fromFile(filePath: string): KeyRingStore {
    if (!fs.existsSync(filePath)) {
      return new KeyRingStore({ version: 1, keys: {} }, filePath);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as KeyRing;
    return new KeyRingStore(parsed, filePath);
  }

  save(): void {
    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.keyRing, null, 2), 'utf8');
    }
  }

  addKey(entry: KeyRingEntry): void {
    this.keyRing.keys[entry.keyId] = { ...entry };
    if (!this.keyRing.defaultKeyId) {
      this.keyRing.defaultKeyId = entry.keyId;
    }
    this.save();
  }

  getKey(keyId: string): KeyRingEntry | undefined {
    return this.keyRing.keys[keyId];
  }

  getAllKeys(): KeyRingEntry[] {
    return Object.values(this.keyRing.keys);
  }

  revokeKey(keyId: string, reason = 'key-revoked'): boolean {
    const key = this.keyRing.keys[keyId];
    if (!key) return false;
    key.revoked = true;
    key.revokedAt = new Date().toISOString();
    key.revocationReason = reason;
    this.save();
    return true;
  }

  rotateKey(oldKeyId: string, newEntry: KeyRingEntry, reason = 'key-rotated'): void {
    this.revokeKey(oldKeyId, reason);
    this.addKey(newEntry);
    this.keyRing.defaultKeyId = newEntry.keyId;
    this.save();
  }

  recoverKey(entry: KeyRingEntry): void {
    // Re-instate or add back key during recovery
    this.keyRing.keys[entry.keyId] = { ...entry, revoked: false, revokedAt: undefined, revocationReason: undefined };
    this.save();
  }

  getDefaultKeyId(): string | undefined {
    return this.keyRing.defaultKeyId;
  }

  setDefaultKeyId(keyId: string): void {
    if (this.keyRing.keys[keyId]) {
      this.keyRing.defaultKeyId = keyId;
      this.save();
    }
  }
}

/**
 * Verify signed manifest envelope and optionally files on disk against md5 digests.
 */
export function verifySignedManifest(
  envelope: SignedManifestEnvelope,
  keyRing: KeyRingStore | KeyRing,
  options?: {
    targetDir?: string;
    currentInstalledVersion?: string;
    allowRollback?: boolean;
    domain?: string;
  }
): VerificationResult {
  if (!envelope || !envelope.payload || !envelope.signature || !envelope.keyId) {
    return { valid: false, reason: 'invalid-envelope', error: 'Envelope missing payload, signature, or keyId' };
  }

  const store = keyRing instanceof KeyRingStore ? keyRing : new KeyRingStore(keyRing);
  const keyEntry = store.getKey(envelope.keyId);

  if (!keyEntry) {
    return { valid: false, reason: 'key-not-found', error: `Key ID ${envelope.keyId} not in keyring` };
  }

  if (keyEntry.revoked) {
    return {
      valid: false,
      reason: 'key-revoked',
      error: `Key ${envelope.keyId} has been revoked: ${keyEntry.revocationReason || 'key-revoked'}`,
    };
  }

  const sigValid = verifyPayloadSignature(
    envelope.payload as unknown as Record<string, unknown>,
    envelope.signature,
    keyEntry.publicKeyPem,
    options?.domain || SIGNING_DOMAIN_PREFIX
  );

  if (!sigValid) {
    return { valid: false, reason: 'signature-mismatch', error: 'Ed25519 signature verification failed' };
  }

  // Anti-rollback check
  if (options?.currentInstalledVersion && !options.allowRollback) {
    const cmp = compareVersions(envelope.payload.version, options.currentInstalledVersion);
    if (cmp < 0) {
      return {
        valid: false,
        reason: 'rollback-violation',
        error: `Monotonic anti-rollback violation: installed=${options.currentInstalledVersion}, manifest=${envelope.payload.version}`,
      };
    }
  }

  // File integrity check if targetDir is specified
  if (options?.targetDir) {
    const checkedFiles: string[] = [];
    const mismatchedFiles: string[] = [];

    for (const [relPath, expectedMd5] of Object.entries(envelope.payload.files)) {
      const fullPath = path.join(options.targetDir, relPath);
      checkedFiles.push(relPath);
      if (!fs.existsSync(fullPath)) {
        return {
          valid: false,
          reason: 'missing-file',
          error: `Required artifact missing: ${relPath}`,
          checkedFiles,
          mismatchedFiles: [relPath],
        };
      }

      const actualMd5 = computeFileMd5(fullPath);
      if (actualMd5.toLowerCase() !== expectedMd5.toLowerCase()) {
        mismatchedFiles.push(relPath);
      }
    }

    if (mismatchedFiles.length > 0) {
      return {
        valid: false,
        reason: 'digest-mismatch',
        error: `MD5 digest mismatch on: ${mismatchedFiles.join(', ')}`,
        checkedFiles,
        mismatchedFiles,
      };
    }

    return { valid: true, reason: 'ok', checkedFiles, mismatchedFiles: [] };
  }

  return { valid: true, reason: 'ok' };
}
