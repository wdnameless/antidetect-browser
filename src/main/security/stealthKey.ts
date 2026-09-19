import * as fs from 'fs';
import * as path from 'path';
import { KeyPairPem, KeyRingStore, generateEd25519KeyPair } from './signing';
import { computeKeyIdFromPublicPem } from './extensionVerifier';
import { protectSecret, revealSecret } from '../util/secretStore';

export interface PersistedStealthKeyRecord {
  version: number;
  keyId: string;
  publicKeyPem: string;
  protectedPrivateKeyPem: string;
  createdAt: string;
}

const STEALTH_KEY_FILENAME = 'stealth-key.json';

// In-memory cache keyed by dataDir
const cachedKeys = new Map<string, KeyPairPem>();
const cachedKeyRings = new Map<string, KeyRingStore>();

/**
 * True when a persisted key already exists on disk in dataDir.
 */
export function hasPersistedStealthKey(dataDir: string): boolean {
  try {
    const filePath = path.join(dataDir, STEALTH_KEY_FILENAME);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Obtain the installation's stealth signing key.
 * Created once, then persisted and reused across restarts.
 *
 * The private half is protected through `secretStore`, which selects the strongest cipher it has
 * been given: DPAPI (`enc:`) when the shell has injected its Rust cipher, otherwise AES-256-GCM
 * under a machine-local key file (`aes:`). This build takes the AES path — nothing calls
 * `setSecretCipher` yet — so the protection is a local key file rather than an OS-bound key.
 * Either way the private key is never written in plaintext.
 */
export function getStealthSigningKey(dataDir: string): KeyPairPem {
  const resolvedDir = path.resolve(dataDir);
  const cached = cachedKeys.get(resolvedDir);
  if (cached) {
    return cached;
  }

  const filePath = path.join(resolvedDir, STEALTH_KEY_FILENAME);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const record = JSON.parse(raw) as PersistedStealthKeyRecord;
      const privateKeyPem = revealSecret(record.protectedPrivateKeyPem);
      if (privateKeyPem && record.publicKeyPem) {
        const pair: KeyPairPem = {
          publicKeyPem: record.publicKeyPem,
          privateKeyPem,
        };
        cachedKeys.set(resolvedDir, pair);
        return pair;
      }
    } catch {
      // If reading/decrypting fails, fall through to regenerate below
    }
  }

  // Generate a new keypair and persist it
  const newPair = generateEd25519KeyPair();
  const keyId = computeKeyIdFromPublicPem(newPair.publicKeyPem);
  const protectedPrivateKeyPem = protectSecret(newPair.privateKeyPem);

  if (!protectedPrivateKeyPem) {
    throw new Error('Failed to protect stealth private key with secret store');
  }

  const record: PersistedStealthKeyRecord = {
    version: 1,
    keyId,
    publicKeyPem: newPair.publicKeyPem,
    protectedPrivateKeyPem,
    createdAt: new Date().toISOString(),
  };

  fs.mkdirSync(resolvedDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');

  cachedKeys.set(resolvedDir, newPair);
  return newPair;
}

/**
 * Obtain a KeyRingStore containing the public key of the persisted stealth key.
 */
export function getStealthKeyRing(dataDir: string): KeyRingStore {
  const resolvedDir = path.resolve(dataDir);
  const cachedRing = cachedKeyRings.get(resolvedDir);
  if (cachedRing) {
    return cachedRing;
  }

  const keyPair = getStealthSigningKey(resolvedDir);
  const keyId = computeKeyIdFromPublicPem(keyPair.publicKeyPem);
  const ring = new KeyRingStore({
    version: 1,
    defaultKeyId: keyId,
    keys: {
      [keyId]: {
        keyId,
        publicKeyPem: keyPair.publicKeyPem,
        createdAt: new Date().toISOString(),
        comment: 'persisted-stealth-key',
      },
    },
  });

  cachedKeyRings.set(resolvedDir, ring);
  return ring;
}

/**
 * Clear cached keys and rings (useful for testing).
 */
export function resetStealthKeyCache(): void {
  cachedKeys.clear();
  cachedKeyRings.clear();
}
