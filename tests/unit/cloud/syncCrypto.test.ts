// The end-to-end sync envelope: the guarantee is that Google (or anyone holding the Drive folder)
// sees ciphertext, and that a wrong passphrase cannot damage local data.
//
// Both halves of that sentence have a failure mode that a happy-path test would miss:
//
// 1. A payload that is uploaded without `sealPayload` still "works" — push succeeds, pull succeeds,
//    and the operator's proxy passwords and cookies sit readable in Drive. The only way to notice is
//    to assert on the bytes that would leave the machine, so this test seals and inspects them.
//
// 2. A pull that decrypts lazily, or writes as it goes, corrupts local data when the passphrase is
//    wrong: the first files succeed, the failure comes later, and the database is left half-merged.
//    `openPayload` must throw before anything is written.
import { describe, it, expect } from 'vitest';
import {
  sealPayload,
  openPayload,
  SyncDecryptError,
  SYNC_ENVELOPE_MAGIC,
  makePassphraseVerifier,
  checkPassphraseVerifier,
} from '../../../src/main/cloud/syncCrypto';

describe('sync envelope', () => {
  const PASSPHRASE = 'correct horse battery staple';
  // Exactly the kind of content that must not appear in Drive: the bundle carries proxy passwords,
  // SSH private keys and live session cookies.
  const SECRET = Buffer.from(
    JSON.stringify({
      profile: { name: 'MEXC-01' },
      proxy: { password: 'S3cret-Proxy-Pass' },
      cookies: [{ name: 'session', value: 'live-session-token-value' }],
    }),
    'utf8'
  );

  it('round-trips the payload', () => {
    const opened = openPayload(PASSPHRASE, sealPayload(PASSPHRASE, SECRET));
    expect(opened.toString('utf8')).toBe(SECRET.toString('utf8'));
  });

  it('leaves no secret readable in the uploaded bytes', () => {
    // This is the assertion that would have caught the original defect, where the bundle was
    // JSON-stringified straight into Drive. A substring search is the honest check: if any of these
    // appear, the envelope is not doing its job regardless of what the format claims.
    const sealed = sealPayload(PASSPHRASE, SECRET);
    const asText = sealed.toString('latin1');
    for (const needle of ['S3cret-Proxy-Pass', 'live-session-token-value', 'MEXC-01', 'password']) {
      expect(asText.includes(needle), `plaintext leaked into the upload: ${needle}`).toBe(false);
    }
    expect(sealed.subarray(0, 4).equals(SYNC_ENVELOPE_MAGIC)).toBe(true);
  });

  it('uses a fresh salt and nonce per call, so identical payloads differ on the wire', () => {
    // Without this, the operator's Drive would leak which days had identical data, and a
    // known-plaintext comparison becomes possible across uploads.
    const a = sealPayload(PASSPHRASE, SECRET);
    const b = sealPayload(PASSPHRASE, SECRET);
    expect(a.equals(b)).toBe(false);
    expect(openPayload(PASSPHRASE, a).equals(openPayload(PASSPHRASE, b))).toBe(true);
  });

  it('throws SyncDecryptError on a wrong passphrase, not a raw crypto error', () => {
    // The distinction is load-bearing: the pull path catches `SyncDecryptError` to report "wrong
    // passphrase" to the operator and abort before writing. A raw `Error` from the cipher would
    // surface as an opaque failure instead.
    const sealed = sealPayload(PASSPHRASE, SECRET);
    expect(() => openPayload('wrong passphrase', sealed)).toThrow(SyncDecryptError);
  });

  it('throws on a tampered blob rather than returning partial data', () => {
    const sealed = sealPayload(PASSPHRASE, SECRET);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0xff; // flip a ciphertext bit — GCM must reject it
    expect(() => openPayload(PASSPHRASE, tampered)).toThrow(SyncDecryptError);
  });

  it('handles an empty payload', () => {
    // A store with no profiles yet seals an empty buffer; failing here would break the very first
    // sync on a fresh install.
    expect(openPayload(PASSPHRASE, sealPayload(PASSPHRASE, Buffer.alloc(0))).length).toBe(0);
  });
});

describe('passphrase verifier', () => {
  it('accepts the passphrase it was made from and rejects others', () => {
    const verifier = makePassphraseVerifier('my long passphrase');
    expect(checkPassphraseVerifier('my long passphrase', verifier)).toBe(true);
    expect(checkPassphraseVerifier('my long passphras', verifier)).toBe(false);
    expect(checkPassphraseVerifier('completely different', verifier)).toBe(false);
  });

  it('leaks nothing that identifies the passphrase', () => {
    // The verifier is the ONE piece of passphrase-derived material allowed to persist. It must not
    // contain the passphrase, and two verifiers for the same passphrase must differ (fresh salt),
    // so it cannot be used as a lookup key or compared across machines.
    const a = makePassphraseVerifier('my long passphrase');
    const b = makePassphraseVerifier('my long passphrase');
    expect(a.toString('latin1').includes('my long passphrase')).toBe(false);
    expect(a.equals(b)).toBe(false);
    // Both still validate the same passphrase, which is the whole point of storing one.
    expect(checkPassphraseVerifier('my long passphrase', a)).toBe(true);
    expect(checkPassphraseVerifier('my long passphrase', b)).toBe(true);
  });
});
