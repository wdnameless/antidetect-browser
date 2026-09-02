import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateEd25519KeyPair,
  signPayload,
  verifyPayloadSignature,
  createSignedManifest,
  verifySignedManifest,
  KeyRingStore,
  computeMd5,
  computeFileMd5,
  buildDirectoryMd5Manifest,
  compareVersions,
} from '../../../src/main/security/signing';
import { canonicalizeJson } from '../../../src/main/security/jcs';

describe('Ed25519 Core & JCS Canonicalization', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-signing-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('canonicalizes JSON deterministically (RFC 8785)', () => {
    const obj1 = { b: 1, a: 2, c: { y: 'test', x: true } };
    const obj2 = { c: { x: true, y: 'test' }, a: 2, b: 1 };
    expect(canonicalizeJson(obj1)).toBe('{"a":2,"b":1,"c":{"x":true,"y":"test"}}');
    expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
  });

  it('performs Ed25519 sign and verify round-trip', () => {
    const keyPair = generateEd25519KeyPair();
    const payload = { version: '1.0.0', data: 'hello' };
    const signature = signPayload(payload, keyPair.privateKeyPem);
    const valid = verifyPayloadSignature(payload, signature, keyPair.publicKeyPem);
    expect(valid).toBe(true);
  });

  it('detects byte-flip tampering in payload or signature', () => {
    const keyPair = generateEd25519KeyPair();
    const payload = { version: '1.0.0', data: 'secure content' };
    const signature = signPayload(payload, keyPair.privateKeyPem);

    // Tamper payload
    const tamperedPayload = { version: '1.0.0', data: 'tampered content' };
    expect(verifyPayloadSignature(tamperedPayload, signature, keyPair.publicKeyPem)).toBe(false);

    // Byte-flip in signature
    const sigBytes = Buffer.from(signature, 'hex');
    sigBytes[0] = sigBytes[0] ^ 0xff;
    const tamperedSig = sigBytes.toString('hex');
    expect(verifyPayloadSignature(payload, tamperedSig, keyPair.publicKeyPem)).toBe(false);
  });

  it('detects byte-flip tamper in manifest files on disk', () => {
    const keyPair = generateEd25519KeyPair();
    const testFile = path.join(tmpDir, 'module.js');
    fs.writeFileSync(testFile, 'console.log("clean");', 'utf8');

    const manifest = buildDirectoryMd5Manifest(tmpDir);
    const envelope = createSignedManifest({
      version: '1.0.0',
      files: manifest,
      keyId: 'key-1',
      privateKeyPem: keyPair.privateKeyPem,
    });

    const keyRing = new KeyRingStore();
    keyRing.addKey({
      keyId: 'key-1',
      publicKeyPem: keyPair.publicKeyPem,
      createdAt: new Date().toISOString(),
    });

    // Valid check
    const res1 = verifySignedManifest(envelope, keyRing, { targetDir: tmpDir });
    expect(res1.valid).toBe(true);
    expect(res1.reason).toBe('ok');

    // Tamper file content on disk (byte flip)
    fs.writeFileSync(testFile, 'console.log("tampered");', 'utf8');
    const res2 = verifySignedManifest(envelope, keyRing, { targetDir: tmpDir });
    expect(res2.valid).toBe(false);
    expect(res2.reason).toBe('digest-mismatch');
    expect(res2.mismatchedFiles).toContain('module.js');
  });

  it('rejects manifests signed with a revoked key (reason: key-revoked)', () => {
    const keyPair = generateEd25519KeyPair();
    const envelope = createSignedManifest({
      version: '1.0.0',
      files: {},
      keyId: 'key-revoked-test',
      privateKeyPem: keyPair.privateKeyPem,
    });

    const keyRing = new KeyRingStore();
    keyRing.addKey({
      keyId: 'key-revoked-test',
      publicKeyPem: keyPair.publicKeyPem,
      createdAt: new Date().toISOString(),
    });

    // Revoke the key
    keyRing.revokeKey('key-revoked-test', 'key-revoked: key exposed');

    const result = verifySignedManifest(envelope, keyRing);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('key-revoked');
    expect(result.error).toContain('revoked');
  });

  it('supports key rotation and recovery in key ring', () => {
    const keyRing = new KeyRingStore();
    const kp1 = generateEd25519KeyPair();
    const kp2 = generateEd25519KeyPair();

    keyRing.addKey({
      keyId: 'k1',
      publicKeyPem: kp1.publicKeyPem,
      createdAt: new Date().toISOString(),
    });
    expect(keyRing.getDefaultKeyId()).toBe('k1');

    // Rotate k1 to k2
    keyRing.rotateKey('k1', {
      keyId: 'k2',
      publicKeyPem: kp2.publicKeyPem,
      createdAt: new Date().toISOString(),
    });

    expect(keyRing.getKey('k1')?.revoked).toBe(true);
    expect(keyRing.getKey('k2')?.revoked).toBeFalsy();
    expect(keyRing.getDefaultKeyId()).toBe('k2');

    // Recovery
    keyRing.recoverKey({
      keyId: 'k1',
      publicKeyPem: kp1.publicKeyPem,
      createdAt: new Date().toISOString(),
    });
    expect(keyRing.getKey('k1')?.revoked).toBe(false);
  });

  it('enforces monotonic anti-rollback verification', () => {
    const keyPair = generateEd25519KeyPair();
    const keyRing = new KeyRingStore();
    keyRing.addKey({
      keyId: 'key-anti-rollback',
      publicKeyPem: keyPair.publicKeyPem,
      createdAt: new Date().toISOString(),
    });

    // Version comparison checks
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);

    // Downgrade attempt: installed 1.5.0, manifest 1.4.0
    const downgradeEnvelope = createSignedManifest({
      version: '1.4.0',
      files: {},
      keyId: 'key-anti-rollback',
      privateKeyPem: keyPair.privateKeyPem,
    });

    const result = verifySignedManifest(downgradeEnvelope, keyRing, {
      currentInstalledVersion: '1.5.0',
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('rollback-violation');

    // Upgrade attempt: installed 1.5.0, manifest 1.5.1
    const upgradeEnvelope = createSignedManifest({
      version: '1.5.1',
      files: {},
      keyId: 'key-anti-rollback',
      privateKeyPem: keyPair.privateKeyPem,
    });

    const upgradeResult = verifySignedManifest(upgradeEnvelope, keyRing, {
      currentInstalledVersion: '1.5.0',
    });
    expect(upgradeResult.valid).toBe(true);
  });
});
