// NullTrace Google Drive Sync Cryptography (Zone A)
//
// End-to-end encryption envelope for Google Drive sync payloads.
// Derives an AES-256 key from an operator passphrase via scrypt (native node:crypto),
// and delegates AEAD encryption to the existing AES-256-GCM implementation in teamCrypto.
//
// Envelope format v1:
//   MAGIC(4)      - 4 bytes ASCII "NTG1" (NullTrace Google Drive v1, defines scrypt N=16384, r=8, p=1)
//   salt(16)      - 16 random bytes for scrypt key derivation
//   nonce(12)     - 12 random bytes AES-GCM IV (from encryptBundle)
//   tag(16)       - 16 bytes AES-GCM authentication tag (from encryptBundle)
//   ciphertext(N) - encrypted payload bytes

import { scryptSync, randomBytes } from 'crypto';
import { encryptBundle, decryptBundle } from '../teams/teamCrypto';

/** Magic + version prefix of every uploaded blob. 4 bytes ASCII "NTG1". */
export const SYNC_ENVELOPE_MAGIC = Buffer.from('NTG1', 'ascii');

/** Minimum envelope size: MAGIC(4) + salt(16) + nonce(12) + tag(16) = 48 bytes */
const MIN_ENVELOPE_LEN = 4 + 16 + 12 + 16;

/** Fixed probe for passphrase verifier (sealed canary) */
const VERIFIER_PROBE = Buffer.from('nulltrace-sync-verifier-v1', 'utf8');

/** Thrown by openPayload when the passphrase is wrong or the blob was tampered with. */
export class SyncDecryptError extends Error {
  constructor(message: string = 'Failed to decrypt sync payload', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncDecryptError';
    Object.setPrototypeOf(this, SyncDecryptError.prototype);
  }
}

/**
 * Derive a 32-byte key from the operator passphrase.
 * scrypt with cost parameters N=16384, r=8, p=1 bound to the "NTG1" envelope version.
 */
export function deriveSyncKey(passphrase: string, salt: Buffer): Buffer {
  if (typeof passphrase !== 'string') {
    throw new TypeError('Passphrase must be a string');
  }
  if (!Buffer.isBuffer(salt) || salt.length < 16) {
    throw new TypeError('Salt must be a Buffer of at least 16 bytes');
  }
  return scryptSync(passphrase, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

/**
 * Seal a payload under the operator passphrase.
 * Layout: MAGIC(4) || salt(16) || nonce(12) || tag(16) || ciphertext. AES-256-GCM.
 */
export function sealPayload(passphrase: string, plaintext: Buffer): Buffer {
  const plainBuf = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(plaintext as unknown as string, 'utf8');
  const salt = randomBytes(16);
  const syncKey = deriveSyncKey(passphrase, salt);
  // encryptBundle layout: nonce(12) || tag(16) || ciphertext
  const encrypted = encryptBundle(syncKey, plainBuf);
  return Buffer.concat([SYNC_ENVELOPE_MAGIC, salt, encrypted]);
}

/**
 * Decrypt a sealed envelope with the operator passphrase.
 * Throws SyncDecryptError on bad passphrase, invalid magic, or tampered data.
 */
export function openPayload(passphrase: string, envelope: Buffer): Buffer {
  if (!Buffer.isBuffer(envelope) || envelope.length < MIN_ENVELOPE_LEN) {
    throw new SyncDecryptError('Payload is too short or invalid sync envelope');
  }

  const magic = envelope.subarray(0, 4);
  if (!magic.equals(SYNC_ENVELOPE_MAGIC)) {
    throw new SyncDecryptError(
      `Invalid sync envelope magic: expected ${SYNC_ENVELOPE_MAGIC.toString('ascii')}`
    );
  }

  const salt = envelope.subarray(4, 20);
  const aeadBlob = envelope.subarray(20);

  let syncKey: Buffer;
  try {
    syncKey = deriveSyncKey(passphrase, salt);
  } catch (err) {
    throw new SyncDecryptError('Key derivation failed', { cause: err });
  }

  try {
    return decryptBundle(syncKey, aeadBlob);
  } catch (err) {
    throw new SyncDecryptError('Failed to decrypt payload: invalid passphrase or corrupted data', {
      cause: err,
    });
  }
}

/**
 * Passphrase check without touching Drive: seal a fixed probe with a random salt and
 * verify it round-trips. Lets the UI validate a passphrase without downloading anything.
 * No passphrase material can be recovered from the resulting sealed probe.
 */
export function makePassphraseVerifier(passphrase: string): Buffer {
  return sealPayload(passphrase, VERIFIER_PROBE);
}

/**
 * Validate a candidate passphrase against a previously sealed verifier probe.
 * Returns true if the passphrase successfully decrypts the probe, false otherwise.
 */
export function checkPassphraseVerifier(passphrase: string, verifier: Buffer): boolean {
  if (!Buffer.isBuffer(verifier) || verifier.length < MIN_ENVELOPE_LEN) {
    return false;
  }
  try {
    const decrypted = openPayload(passphrase, verifier);
    return decrypted.equals(VERIFIER_PROBE);
  } catch {
    return false;
  }
}
