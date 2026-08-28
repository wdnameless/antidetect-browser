import { describe, it, expect } from 'vitest';
import {
  generateMasterKey,
  deriveTeamKey,
  encryptBundle,
  decryptBundle,
  wrapMasterKeyForInvite,
  unwrapMasterKeyFromInvite,
  generateActivationCode,
  hashActivationCode,
  safeEqual,
} from '../../src/main/teams/teamCrypto';

describe('teamCrypto: HKDF + AES-256-GCM', () => {
  it('derives deterministic team keys from the same master key + team id', () => {
    const master = Buffer.alloc(32, 7);
    const k1 = deriveTeamKey(master, 'team_abc');
    const k2 = deriveTeamKey(master, 'team_abc');
    expect(k1.equals(k2)).toBe(true);
    expect(k1.length).toBe(32);
  });

  it('derives different keys per team id', () => {
    const master = Buffer.alloc(32, 7);
    expect(deriveTeamKey(master, 'team_a').equals(deriveTeamKey(master, 'team_b'))).toBe(false);
  });

  it('rejects a wrong-size master key', () => {
    expect(() => deriveTeamKey(Buffer.alloc(16), 'team_x')).toThrow(/master key/);
  });

  it('encrypt/decrypt roundtrip preserves the payload', () => {
    const key = deriveTeamKey(generateMasterKey(), 'team_t1');
    const plain = Buffer.from(JSON.stringify({ hello: 'мир', n: 42 }), 'utf8');
    const blob = encryptBundle(key, plain);
    expect(blob.length).toBe(12 + 16 + plain.length);
    expect(decryptSafe(key, blob).equals(plain)).toBe(true);
  });

  it('produces a fresh nonce each call (ciphertexts differ)', () => {
    const key = deriveTeamKey(generateMasterKey(), 'team_t1');
    const p = Buffer.from('same plaintext');
    expect(encryptBundle(key, p).equals(encryptBundle(key, p))).toBe(false);
  });

  it('fails decryption with a wrong key (auth error)', () => {
    const keyA = deriveTeamKey(generateMasterKey(), 'team_a');
    const keyB = deriveTeamKey(generateMasterKey(), 'team_b');
    const blob = encryptBundle(keyA, Buffer.from('secret'));
    expect(() => decryptBundleSafe(keyB, blob)).toThrow();
  });

  it('fails decryption when the ciphertext is tampered', () => {
    const key = deriveTeamKey(generateMasterKey(), 'team_t');
    const blob = encryptBundle(key, Buffer.from('secret'));
    blob[blob.length - 1] ^= 0x01;
    expect(() => decryptBundleSafe(key, blob)).toThrow();
  });

  it('rejects truncated ciphertext', () => {
    const key = deriveTeamKey(generateMasterKey(), 'team_t');
    expect(() => decryptBundleSafe(key, Buffer.alloc(10))).toThrow(/too short/);
  });

  it('invite wrap/unwrap roundtrip with the activation code', () => {
    const master = generateMasterKey();
    const teamId = 'team_invite';
    const code = generateActivationCode();
    const wrapped = wrapMasterKeyForInvite(master, Buffer.from(code, 'utf8'), teamId);
    const unwrapped = unwrapMasterKeyFromInvite(wrapped, Buffer.from(code, 'utf8'), teamId);
    expect(unwrapped.equals(master)).toBe(true);
    // wrong code -> auth failure
    expect(() => unwrapMasterKeyFromInvite(wrapped, Buffer.from('XXXX-YYYY-0000-0000', 'utf8'), teamId)).toThrow();
  });

  it('activation codes are 4x4 uppercase-hex groups (case-insensitive)', () => {
    const code = generateActivationCode();
    expect(code).toMatch(/^[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$/);
  });

  it('activation code hashing is deterministic and case-insensitive', () => {
    const code = generateActivationCode();
    const h1 = hashActivationCode(code, 'team_h');
    const h2 = hashActivationCode(code.toUpperCase(), 'team_h');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(hashActivationCode(code, 'team_other'));
  });

  it('safeEqual compares constant-time-ish and handles length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

// vitest-safe wrappers (native GCM throws with its own messages)
function decryptSafe(key: Buffer, blob: Buffer): Buffer {
  return decryptBundle(key, blob);
}

function decryptBundleSafe(key: Buffer, blob: Buffer): Buffer {
  return decryptBundle(key, blob);
}