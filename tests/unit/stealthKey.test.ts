import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getStealthSigningKey, getStealthKeyRing, hasPersistedStealthKey } from '../../src/main/security/stealthKey';
import { writeStealthExtension } from '../../src/main/proxy/stealthInjection';
import {
  verifyStealthExtensionDirectory,
  readStealthManifestEnvelope,
  STEALTH_SIG_FILENAME,
} from '../../src/main/security/extensionVerifier';

describe('stealthKey durable signing and verification', () => {
  let testDataDir: string;

  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stealth-key-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('getStealthSigningKey returns same key across calls and reproduces across module reset', async () => {
    const { getStealthSigningKey, hasPersistedStealthKey } = await import('../../src/main/security/stealthKey');

    expect(hasPersistedStealthKey(testDataDir)).toBe(false);
    const key1 = getStealthSigningKey(testDataDir);
    expect(hasPersistedStealthKey(testDataDir)).toBe(true);

    const key2 = getStealthSigningKey(testDataDir);
    expect(key1.publicKeyPem).toBe(key2.publicKeyPem);
    expect(key1.privateKeyPem).toBe(key2.privateKeyPem);

    // Simulate restart with vi.resetModules()
    vi.resetModules();
    const freshModule = await import('../../src/main/security/stealthKey');
    const keyAfterRestart = freshModule.getStealthSigningKey(testDataDir);

    expect(keyAfterRestart.publicKeyPem).toBe(key1.publicKeyPem);
    expect(keyAfterRestart.privateKeyPem).toBe(key1.privateKeyPem);
  });

  it('an artifact signed with the persisted key verifies in a fresh module state', async () => {
    const stealthKeyMod = await import('../../src/main/security/stealthKey');
    const signingKey = stealthKeyMod.getStealthSigningKey(testDataDir);

    const { writeStealthExtension } = await import('../../src/main/proxy/stealthInjection');
    const extDir = path.join(testDataDir, 'test-profile-stealth-ext');
    writeStealthExtension(extDir, true, { signingKey });

    // Verify in a fresh module state
    vi.resetModules();
    const freshStealthKeyMod = await import('../../src/main/security/stealthKey');
    const freshVerifierMod = await import('../../src/main/security/extensionVerifier');

    const persistentRing = freshStealthKeyMod.getStealthKeyRing(testDataDir);
    const result = freshVerifierMod.verifyStealthExtensionDirectory(extDir, {
      profileId: 'p-test-1',
      keyRing: persistentRing,
    });

    expect(result.allowed).toBe(true);
  });

  it('R06: an artifact whose stealth.js was altered after signing is still REFUSED', async () => {
    const stealthKeyMod = await import('../../src/main/security/stealthKey');
    const signingKey = stealthKeyMod.getStealthSigningKey(testDataDir);

    const { writeStealthExtension } = await import('../../src/main/proxy/stealthInjection');
    const extDir = path.join(testDataDir, 'test-profile-tampered-ext');
    writeStealthExtension(extDir, true, { signingKey });

    // Tamper with stealth.js
    const scriptPath = path.join(extDir, 'stealth.js');
    fs.appendFileSync(scriptPath, '\n// MALICIOUS INJECTION');

    const verifierMod = await import('../../src/main/security/extensionVerifier');
    const persistentRing = stealthKeyMod.getStealthKeyRing(testDataDir);

    expect(() => {
      verifierMod.verifyStealthExtensionDirectory(extDir, {
        profileId: 'p-tampered',
        keyRing: persistentRing,
      });
    }).toThrow(verifierMod.StealthExtensionVerificationError);
  });

  it('the persisted file does not contain the private key in plaintext', async () => {
    const { getStealthSigningKey } = await import('../../src/main/security/stealthKey');
    const keyPair = getStealthSigningKey(testDataDir);

    const keyFilePath = path.join(testDataDir, 'stealth-key.json');
    const rawFileContent = fs.readFileSync(keyFilePath, 'utf8');

    // Must NOT contain the plaintext PEM header or raw private key body
    expect(rawFileContent).not.toContain('-----BEGIN PRIVATE KEY-----');
    expect(rawFileContent).not.toContain('-----BEGIN EC PRIVATE KEY-----');
    expect(rawFileContent).not.toContain(keyPair.privateKeyPem);

    const parsed = JSON.parse(rawFileContent);
    expect(parsed.protectedPrivateKeyPem).toBeDefined();
    expect(parsed.publicKeyPem).toBe(keyPair.publicKeyPem);
  });

  it('a re-signed artifact still verifies — the envelope does not cover itself', async () => {
    // The defect this pins: `buildDirectoryMd5Manifest` used to include the envelope file, so
    // the manifest recorded the PREVIOUS envelope's digest and the write that followed broke it.
    // A first signature verified; every re-signature failed with `digest-mismatch`, which made
    // an artifact signable exactly once. Regeneration re-signs, so this is the path that broke
    // the operator's launches.
    const signingKey = getStealthSigningKey(testDataDir);
    const extDir = path.join(testDataDir, 're-sign-ext');

    // Sign it three times over the same directory. The first is the ordinary case; the rest are
    // what a regeneration does.
    for (let pass = 1; pass <= 3; pass++) {
      writeStealthExtension(extDir, true, { signingKey });
      const result = verifyStealthExtensionDirectory(extDir, {
        profileId: 'p-resign',
        keyRing: getStealthKeyRing(testDataDir),
      });
      expect(result.allowed, `signature pass ${pass} must verify`).toBe(true);
    }
  });

  it('the envelope never lists itself in the signed file manifest', async () => {
    const signingKey = getStealthSigningKey(testDataDir);
    const extDir = path.join(testDataDir, 'self-manifest-ext');
    writeStealthExtension(extDir, true, { signingKey });

    const envelope = readStealthManifestEnvelope(extDir);
    expect(envelope).not.toBeNull();
    const signed = Object.keys(envelope!.payload.files);
    expect(signed).not.toContain(STEALTH_SIG_FILENAME);
    // The files that ARE covered must be the real artifact.
    expect(signed).toContain('stealth.js');
    expect(signed).toContain('manifest.json');
  });
});
