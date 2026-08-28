// Team crypto (Sprint 1): HKDF key derivation + AES-256-GCM bundle encryption.
//
// Wire-format v1:
//   team master key  — 32 random bytes, generated on the owner's device at team
//                      creation, stored in the local secret store (never sent
//                      in plaintext).
//   team bundle key  — HKDF-SHA256(masterKey, salt=team_id, info="bundle-enc-v1")
//                      used for AES-256-GCM encryption of profile bundles.
//   invite wrapping  — HKDF-SHA256(activationKey, salt=team_id,
//                      info="invite-wrap-v1") wraps the master key so an
//                      invitee holding only the activation code can unwrap it.
//
// Ciphertext layout: nonce(12) || authTag(16) || ciphertext. Only native
// node:crypto is used — no third-party dependencies.

import {
  hkdfSync,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  createHmac,
} from 'crypto';

export const MASTER_KEY_LEN = 32;
export const NONCE_LEN = 12;

function assertLen(buf: Buffer, len: number, what: string): Buffer {
  if (buf.length !== len) {
    throw new Error(`invalid ${what} length: expected ${len}, got ${buf.length}`);
  }
  return buf;
}

/** Derive the per-team bundle encryption key (AES-256) from the master key. */
export function deriveTeamKey(masterKey: Buffer, teamId: string): Buffer {
  assertLen(masterKey, MASTER_KEY_LEN, 'master key');
  return Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.from(teamId, 'utf8'), Buffer.from('bundle-enc-v1'), 32)
  );
}

/** AES-256-GCM encrypt. Layout: nonce(12) || tag(16) || ciphertext. */
export function encryptBundle(teamKey: Buffer, plaintext: Buffer): Buffer {
  assertLen(teamKey, 32, 'team key');
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', teamKey, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), enc]);
}

/** AES-256-GCM decrypt of the nonce||tag||ciphertext layout. Throws on tamper. */
export function decryptBundle(teamKey: Buffer, blob: Buffer): Buffer {
  assertLen(teamKey, 32, 'team key');
  if (blob.length < NONCE_LEN + 16) throw new Error('ciphertext too short');
  const nonce = blob.subarray(0, NONCE_LEN);
  const tag = blob.subarray(NONCE_LEN, NONCE_LEN + 16);
  const enc = blob.subarray(NONCE_LEN + 16);
  const decipher = createDecipheriv('aes-256-gcm', teamKey, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

/** Generate a fresh 32-byte team master key. */
export function generateMasterKey(): Buffer {
  return randomBytes(MASTER_KEY_LEN);
}

/**
 * Wrap the team master key for an invitee: HKDF(activationKey) -> AES-256-GCM
 * over the master key. The activation code never travels with the blob.
 */
export function wrapMasterKeyForInvite(masterKey: Buffer, activationKey: Buffer, teamId: string): Buffer {
  const kek = Buffer.from(
    hkdfSync('sha256', activationKey, Buffer.from(teamId, 'utf8'), Buffer.from('invite-wrap-v1'), 32)
  );
  return encryptBundle(kek, masterKey);
}

/** Unwrap an invite key blob with the activation code-derived key. */
export function unwrapMasterKeyFromInvite(wrapped: Buffer, activationKey: Buffer, teamId: string): Buffer {
  const kek = Buffer.from(
    hkdfSync('sha256', activationKey, Buffer.from(teamId, 'utf8'), Buffer.from('invite-wrap-v1'), 32)
  );
  return decryptBundle(kek, wrapped);
}

/** Human-friendly, single-use activation code (e.g. ABCD-EFGH-1234-5678). */
export function generateActivationCode(): string {
  const raw = randomBytes(8).toString('hex').toUpperCase();
  const groups = raw.match(/.{1,4}/g) ?? [];
  return groups.join('-');
}

/** Activation codes are stored hashed (sha256, salted with the team id). */
export function hashActivationCode(code: string, teamId: string): string {
  return createHash('sha256').update(`${teamId}:${code.trim().toUpperCase()}`).digest('hex');
}

/**
 * Constant-time comparison for code hashes / signature buffers.
 */
export function safeEqual(a: Buffer | string, b: Buffer | string): boolean {
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8');
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // still burn a comparison to keep timing flat
    createHmac('sha256', bb).update(ba).digest();
    return false;
  }
  return createHmac('sha256', bb).update(ba).digest().equals(createHmac('sha256', bb).update(bb).digest());
}

/** Stable device fingerprint for RBAC membership checks. */
export function getDeviceId(): string {
  // Deterministic per installation: derived from the machine hostname + a
  // persistent random seed kept in DATA_DIR. Falls back gracefully.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DATA_DIR } = require('../config') as { DATA_DIR: string };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path') as typeof import('path');
  const file = path.join(DATA_DIR, 'device.id');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const id = randomBytes(16).toString('hex');
    fs.writeFileSync(file, id, 'utf8');
    return id;
  } catch {
    return createHash('sha256').update(require('os').hostname()).digest('hex').slice(0, 32);
  }
}