import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  signStealthExtension,
  verifyStealthExtensionDirectory,
  StealthExtensionVerificationError,
  getEphemeralStealthKeyPair,
  getEphemeralStealthKeyRing,
  setEphemeralStealthKeyRing,
  readStealthManifestEnvelope,
} from '../../../src/main/security/extensionVerifier';
import {
  writeStealthExtension,
  StealthOptions,
} from '../../../src/main/proxy/stealthInjection';
import { generateEd25519KeyPair, KeyRingStore } from '../../../src/main/security/signing';

describe('extensionVerifier (Task 2.2)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stealth-ext-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    setEphemeralStealthKeyRing(null);
  });

  const sampleStealthOpts: StealthOptions = {
    mobile: false,
    logicalPlatform: 'windows',
    hardwareConcurrency: 8,
    deviceMemory: 16,
  };

  it('generates, signs, and verifies a valid stealth extension artifact', () => {
    const keyPair = getEphemeralStealthKeyPair();
    writeStealthExtension(tmpDir, sampleStealthOpts, { signingKey: keyPair });

    const envelope = readStealthManifestEnvelope(tmpDir);
    expect(envelope).not.toBeNull();
    expect(envelope?.payload.files['manifest.json']).toBeDefined();
    expect(envelope?.payload.files['stealth.js']).toBeDefined();

    const result = verifyStealthExtensionDirectory(tmpDir, {
      profileId: 'test-prof-1',
    });
    expect(result.allowed).toBe(true);
    expect(result.devBypassApplied).toBe(false);
  });

  it('refuses launch when stealth extension is unsigned (fails closed with remediation error)', () => {
    writeStealthExtension(tmpDir, sampleStealthOpts); // No signingKey passed

    expect(() => {
      verifyStealthExtensionDirectory(tmpDir, {
        profileId: 'unsigned-profile-id',
      });
    }).toThrow(StealthExtensionVerificationError);

    try {
      verifyStealthExtensionDirectory(tmpDir, {
        profileId: 'unsigned-profile-id',
      });
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(StealthExtensionVerificationError);
      const verifyErr = err as StealthExtensionVerificationError;
      expect(verifyErr.name).toBe('StealthExtensionVerificationError');
      expect(verifyErr.profileId).toBe('unsigned-profile-id');
      expect(verifyErr.artifactPath).toBe(tmpDir);
      expect(verifyErr.message).toContain('unsigned-profile-id');
      expect(verifyErr.message).toContain(tmpDir);
      expect(verifyErr.message).toContain('Security Remediation Required');
    }
  });

  it('refuses launch when stealth extension file is tampered after signing', () => {
    const keyPair = getEphemeralStealthKeyPair();
    writeStealthExtension(tmpDir, sampleStealthOpts, { signingKey: keyPair });

    // Tamper with stealth.js
    const scriptPath = path.join(tmpDir, 'stealth.js');
    fs.appendFileSync(scriptPath, '\n// malicious payload injected\nwindow.evil = 1;');

    expect(() => {
      verifyStealthExtensionDirectory(tmpDir, {
        profileId: 'tampered-profile-id',
      });
    }).toThrow(StealthExtensionVerificationError);

    try {
      verifyStealthExtensionDirectory(tmpDir, {
        profileId: 'tampered-profile-id',
      });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(StealthExtensionVerificationError);
      const verifyErr = err as StealthExtensionVerificationError;
      expect(verifyErr.profileId).toBe('tampered-profile-id');
      expect(verifyErr.artifactPath).toBe(tmpDir);
      expect(verifyErr.message).toContain('tampered-profile-id');
    }
  });

  it('refuses launch when manifest.json is tampered', () => {
    const keyPair = getEphemeralStealthKeyPair();
    writeStealthExtension(tmpDir, sampleStealthOpts, { signingKey: keyPair });

    // Tamper with manifest.json
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    parsed.name = 'Tampered Extension';
    fs.writeFileSync(manifestPath, JSON.stringify(parsed, null, 2), 'utf8');

    expect(() => {
      verifyStealthExtensionDirectory(tmpDir, {
        profileId: 'tampered-manifest-prof',
      });
    }).toThrow(StealthExtensionVerificationError);
  });

  it('refuses launch when signed with untrusted / unknown key', () => {
    const foreignKeyPair = generateEd25519KeyPair();
    writeStealthExtension(tmpDir, sampleStealthOpts, { signingKey: foreignKeyPair });

    expect(() => {
      verifyStealthExtensionDirectory(tmpDir, {
        profileId: 'untrusted-key-prof',
        keyRing: getEphemeralStealthKeyRing(),
      });
    }).toThrow(StealthExtensionVerificationError);
  });
});
