import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isUnsignedDevAllowed,
  verifyScriptModule,
  verifyStealthExtension,
} from '../../../src/main/security/enforcement';
import {
  generateEd25519KeyPair,
  createSignedManifest,
  buildDirectoryMd5Manifest,
  KeyRingStore,
} from '../../../src/main/security/signing';

describe('Enforcement & --allow-unsigned-dev Policy', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalArgv = [...process.argv];

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.argv = [...originalArgv];
  });

  it('proves production builds strictly ignore --allow-unsigned-dev', () => {
    // In production NODE_ENV, flag must be ignored
    process.env.NODE_ENV = 'production';
    expect(isUnsignedDevAllowed({ allowUnsignedDev: true })).toBe(false);

    // If packaged is true, flag must be ignored
    process.env.NODE_ENV = 'development';
    expect(isUnsignedDevAllowed({ allowUnsignedDev: true, isPackaged: true })).toBe(false);

    // In dev mode without packaged, allowUnsignedDev is honored
    expect(isUnsignedDevAllowed({ allowUnsignedDev: true, isPackaged: false })).toBe(true);
  });

  it('fails closed on unsigned script module in non-dev or production', () => {
    const keyRing = new KeyRingStore();
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

    // Packaged / prod
    const res = verifyScriptModule('test-script', '/some/path', null, keyRing, {
      isPackaged: true,
      allowUnsignedDev: true, // Should be ignored in packaged
      logger,
    });

    expect(res.allowed).toBe(false);
    expect(res.devBypassApplied).toBe(false);
    expect(res.reason).toBe('missing-signature');
    expect(logger.error).toHaveBeenCalled();
    expect(res.auditRecord?.action).toBe('deny');
  });

  it('allows unsigned script module only when --allow-unsigned-dev is enabled in dev', () => {
    const keyRing = new KeyRingStore();
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

    const res = verifyScriptModule('test-script-dev', '/some/path', null, keyRing, {
      isPackaged: false,
      allowUnsignedDev: true,
      logger,
    });

    expect(res.allowed).toBe(true);
    expect(res.devBypassApplied).toBe(true);
    expect(res.reason).toBe('unsigned-dev-override');
    expect(logger.warn).toHaveBeenCalled();
    expect(res.auditRecord?.action).toBe('allow');
    expect(res.auditRecord?.devBypass).toBe(true);
  });

  it('verifies valid signed stealth extension and refuses tampered extension', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ext-test-'));
    try {
      const extFile = path.join(tmpDir, 'manifest.json');
      fs.writeFileSync(extFile, '{"name":"stealth-ext"}', 'utf8');

      const kp = generateEd25519KeyPair();
      const keyRing = new KeyRingStore();
      keyRing.addKey({
        keyId: 'ext-key',
        publicKeyPem: kp.publicKeyPem,
        createdAt: new Date().toISOString(),
      });

      const manifestFiles = buildDirectoryMd5Manifest(tmpDir);
      const envelope = createSignedManifest({
        version: '1.0.0',
        files: manifestFiles,
        keyId: 'ext-key',
        privateKeyPem: kp.privateKeyPem,
      });

      // 1. Valid verification
      const validRes = verifyStealthExtension('stealth-v1', tmpDir, envelope, keyRing, {
        isPackaged: true,
      });
      expect(validRes.allowed).toBe(true);
      expect(validRes.devBypassApplied).toBe(false);

      // 2. Tampered file
      fs.writeFileSync(extFile, '{"name":"tampered-ext"}', 'utf8');
      const tamperedRes = verifyStealthExtension('stealth-v1', tmpDir, envelope, keyRing, {
        isPackaged: true,
      });
      expect(tamperedRes.allowed).toBe(false);
      expect(tamperedRes.reason).toBe('digest-mismatch');
      expect(tamperedRes.auditRecord?.action).toBe('deny');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
