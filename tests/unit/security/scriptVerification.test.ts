import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateEd25519KeyPair,
  createSignedManifest,
  KeyRingStore,
  KeyPairPem,
  computeFileMd5,
} from '../../../src/main/security/signing';
import {
  verifyScriptModule,
  isUnsignedDevAllowed,
  getDefaultKeyRing,
  setDefaultKeyRing,
} from '../../../src/main/security/enforcement';
import {
  runScript,
  invokeScriptTask,
  createScript,
  initScriptEngine,
} from '../../../src/main/scripts/scriptEngine';
import { initDb } from '../../../src/main/db';

describe('Task 2.1 & 2.4 - Secure Runtime Supply Chain: Script Engine Verification & Dev Bypass', () => {
  let tmpDir: string;
  let keyRing: KeyRingStore;
  let keyPair: KeyPairPem;
  const keyId = 'test-key-1';
  const originalEnv = process.env.NODE_ENV;
  const originalArgv = [...process.argv];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-sec-test-'));
    keyPair = generateEd25519KeyPair();
    keyRing = new KeyRingStore();
    keyRing.addKey({
      keyId,
      publicKeyPem: keyPair.publicKeyPem,
      status: 'active',
      addedAt: new Date().toISOString(),
    });
    setDefaultKeyRing(keyRing);
    await initDb(':memory:');
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.argv = [...originalArgv];
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('2.1 Module signature verification & audit logging', () => {
    it('refuses unsigned module execution and creates audit entry', () => {
      const scriptFile = path.join(tmpDir, 'module.js');
      fs.writeFileSync(scriptFile, 'console.log("hello");', 'utf-8');

      const verification = verifyScriptModule('test-module-unsigned', scriptFile, null, keyRing, {
        allowUnsignedDev: false,
        isPackaged: true,
      });

      expect(verification.allowed).toBe(false);
      expect(verification.reason).toBe('missing-signature');
      expect(verification.auditRecord).toMatchObject({
        artifactType: 'script',
        identifier: 'test-module-unsigned',
        action: 'deny',
        devBypass: false,
        reason: 'missing-signature',
      });
    });

    it('refuses tampered module (byte-flip) execution and logs audit refusal', () => {
      const scriptFile = path.join(tmpDir, 'module.js');
      fs.writeFileSync(scriptFile, 'console.log("legitimate code");', 'utf-8');

      const manifest = createSignedManifest({
        version: '1.0.0',
        files: { 'module.js': computeFileMd5(scriptFile) },
        privateKeyPem: keyPair.privateKeyPem,
        keyId,
      });

      // Tamper: byte-flip
      fs.writeFileSync(scriptFile, 'console.log("tampered evil code");', 'utf-8');

      const verification = verifyScriptModule('test-module', scriptFile, manifest, keyRing, {
        allowUnsignedDev: false,
        isPackaged: true,
      });

      expect(verification.allowed).toBe(false);
      expect(verification.reason).toBe('digest-mismatch');
      expect(verification.auditRecord).toMatchObject({
        artifactType: 'script',
        identifier: 'test-module',
        action: 'deny',
        devBypass: false,
        reason: 'digest-mismatch',
      });
    });

    it('allows signed valid module to execute', () => {
      const scriptFile = path.join(tmpDir, 'module.js');
      fs.writeFileSync(scriptFile, 'console.log("legitimate code");', 'utf-8');

      const manifest = createSignedManifest({
        version: '1.0.0',
        files: { 'module.js': computeFileMd5(scriptFile) },
        privateKeyPem: keyPair.privateKeyPem,
        keyId,
      });
      const verification = verifyScriptModule('test-module', scriptFile, manifest, keyRing, {
        allowUnsignedDev: false,
        isPackaged: true,
      });

      expect(verification.allowed).toBe(true);
      expect(verification.devBypassApplied).toBe(false);
      expect(verification.reason).toBe('signature-verified');
      expect(verification.auditRecord).toMatchObject({
        artifactType: 'script',
        identifier: 'test-module',
        action: 'allow',
        devBypass: false,
        reason: 'signature-verified',
      });
    });

    it('runScript refuses unsigned script execution when unsigned dev is not active', async () => {
      const { id } = createScript('unverified-script', 'const a = 1;');
      expect(() => {
        runScript(id, ['profile-1'], {
          manifestEnvelope: null,
          keyRing,
          policyOpts: { isPackaged: true, allowUnsignedDev: false },
        });
      }).toThrow(/Execution refused for script/);
    });

    it('invokeScriptTask refuses tampered script task execution', () => {
      const scriptFile = path.join(tmpDir, 'task.js');
      fs.writeFileSync(scriptFile, 'const x = 1;', 'utf-8');

      const manifest = createSignedManifest({
        version: '1.0.0',
        files: { 'task.js': computeFileMd5(scriptFile) },
        privateKeyPem: keyPair.privateKeyPem,
        keyId,
      });

      // Tamper
      fs.writeFileSync(scriptFile, 'const x = 2; // altered', 'utf-8');

      expect(() => {
        invokeScriptTask({
          scriptId: 'task-module',
          modulePath: scriptFile,
          code: 'const x = 2;',
          profileId: 'profile-1',
          manifestEnvelope: manifest,
          keyRing,
          policyOpts: { isPackaged: true },
        });
      }).toThrow(/Execution refused for script task 'task-module': digest-mismatch/);
    });
  });

  describe('2.4 Dev flag matrix: --allow-unsigned-dev in prod vs non-prod', () => {
    it('honors --allow-unsigned-dev in development / non-prod (isPackaged: false)', () => {
      process.env.NODE_ENV = 'development';
      const allowed = isUnsignedDevAllowed({
        allowUnsignedDev: true,
        isPackaged: false,
      });
      expect(allowed).toBe(true);

      const warnSpy = vi.fn();
      const verification = verifyScriptModule('dev-module', tmpDir, null, keyRing, {
        allowUnsignedDev: true,
        isPackaged: false,
        logger: { warn: warnSpy, error: vi.fn() },
      });

      expect(verification.allowed).toBe(true);
      expect(verification.devBypassApplied).toBe(true);
      expect(verification.reason).toBe('unsigned-dev-override');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SECURITY WARNING] Allowing unsigned script module')
      );
    });

    it('honors --allow-unsigned-dev from process.argv in non-prod', () => {
      process.env.NODE_ENV = 'development';
      process.argv.push('--allow-unsigned-dev');

      const allowed = isUnsignedDevAllowed({
        isPackaged: false,
      });
      expect(allowed).toBe(true);
    });

    it('IGNORES --allow-unsigned-dev when isPackaged: true (production build)', () => {
      process.env.NODE_ENV = 'development'; // even if env is dev, isPackaged trumps
      process.argv.push('--allow-unsigned-dev');

      const allowed = isUnsignedDevAllowed({
        allowUnsignedDev: true,
        isPackaged: true,
      });
      expect(allowed).toBe(false);

      const verification = verifyScriptModule('prod-module', tmpDir, null, keyRing, {
        allowUnsignedDev: true,
        isPackaged: true,
      });
      expect(verification.allowed).toBe(false);
      expect(verification.reason).toBe('missing-signature');
    });

    it('IGNORES --allow-unsigned-dev when NODE_ENV === "production"', () => {
      process.env.NODE_ENV = 'production';
      process.argv.push('--allow-unsigned-dev');

      const allowed = isUnsignedDevAllowed({
        allowUnsignedDev: true,
        isPackaged: false,
      });
      expect(allowed).toBe(false);

      const verification = verifyScriptModule('prod-module', tmpDir, null, keyRing, {
        allowUnsignedDev: true,
        isPackaged: false,
      });
      expect(verification.allowed).toBe(false);
      expect(verification.reason).toBe('missing-signature');
    });

    it('runScript honors dev bypass only when in non-prod', async () => {
      const { id } = createScript('dev-script', 'const a = 1;');

      // In non-prod with bypass: does not throw on signature check
      const handle = runScript(id, [], {
        manifestEnvelope: null,
        keyRing,
        policyOpts: { isPackaged: false, allowUnsignedDev: true },
      });
      expect(handle).toBeDefined();

      // In prod with bypass flag passed: MUST throw
      expect(() => {
        runScript(id, [], {
          manifestEnvelope: null,
          keyRing,
          policyOpts: { isPackaged: true, allowUnsignedDev: true },
        });
      }).toThrow(/Execution refused for script/);
    });
  });
});
