import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateEd25519KeyPair,
  createSignedManifest,
  buildDirectoryMd5Manifest,
  KeyRingStore,
  SignedManifestEnvelope,
} from '../../../src/main/security/signing';
import {
  verifyUpdateBeforeApply,
  applyVerifiedRuntimeUpdate,
  attachAutoUpdaterSecurity,
  attachSecureUpdater,
  AutoUpdaterLike,
} from '../../../src/main/security/updaterIntegration';
import {
  loadRollbackState,
  saveRollbackState,
  recoverPendingUpdate,
  applyReleaseUpdate,
} from '../../../src/main/security/releaseVerifier';
describe('Secure Runtime Supply Chain - Updater Integration (Task 2.3)', () => {
  let tmpDir: string;
  let targetDir: string;
  let stagingDir: string;
  let backupDir: string;
  let stateFile: string;
  let keyPair: { publicKeyPem: string; privateKeyPem: string };
  let keyRing: KeyRingStore;
  const keyId = 'test-updater-key-1';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-sec-test-'));
    targetDir = path.join(tmpDir, 'installed-runtime');
    stagingDir = path.join(tmpDir, 'download-staging');
    backupDir = path.join(tmpDir, 'backup');
    stateFile = path.join(tmpDir, 'rollback-state.json');

    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    // Populate current target runtime version 1.0.0
    fs.writeFileSync(path.join(targetDir, 'core.exe'), 'v1.0.0-binary');
    fs.writeFileSync(path.join(targetDir, 'version.txt'), '1.0.0');

    // Initialize key pair and store
    keyPair = generateEd25519KeyPair();
    keyRing = new KeyRingStore();
    keyRing.addKey({
      keyId,
      publicKeyPem: keyPair.publicKeyPem,
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore tmp cleanup error
    }
  });

  function createSignedUpdate(version: string, files: Record<string, string>): SignedManifestEnvelope {
    // Write files to staging directory
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(stagingDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }

    const filesManifest = buildDirectoryMd5Manifest(stagingDir);
    return createSignedManifest({
      version,
      files: filesManifest,
      keyId,
      privateKeyPem: keyPair.privateKeyPem,
    });
  }

  it('verifies and applies a valid update manifest with higher monotonic version', () => {
    const envelope = createSignedUpdate('1.1.0', {
      'core.exe': 'v1.1.0-new-binary',
      'version.txt': '1.1.0',
    });

    const verifyResult = verifyUpdateBeforeApply({
      manifestEnvelope: envelope,
      targetDir,
      downloadStagingDir: stagingDir,
      currentInstalledVersion: '1.0.0',
      config: { keyRing },
    });

    expect(verifyResult.allowed).toBe(true);
    expect(verifyResult.manifest).toBeDefined();
    expect(verifyResult.manifest?.version).toBe('1.1.0');

    // Apply update
    const applyResult = applyVerifiedRuntimeUpdate({
      stagedDir: stagingDir,
      targetDir,
      backupDir,
      stateFile,
      manifestEnvelope: envelope,
      keyRing,
      currentInstalledVersion: '1.0.0',
    });

    expect(applyResult.success).toBe(true);
    expect(applyResult.installedVersion).toBe('1.1.0');
    expect(fs.readFileSync(path.join(targetDir, 'core.exe'), 'utf8')).toBe('v1.1.0-new-binary');

    // Rollback state recorded
    const state = loadRollbackState(stateFile);
    expect(state.currentVersion).toBe('1.1.0');
    expect(state.updatePending).toBe(false);
  });

  it('refuses update when artifact digest has been tampered with and logs audit entry', () => {
    const envelope = createSignedUpdate('1.1.0', {
      'core.exe': 'v1.1.0-binary',
      'version.txt': '1.1.0',
    });

    // Tamper with core.exe in staging directory after signing
    fs.writeFileSync(path.join(stagingDir, 'core.exe'), 'MALICIOUS_TAMPERED_CONTENT');

    const errorLogs: string[] = [];
    const mockLogger = {
      warn: vi.fn(),
      error: (msg: string) => errorLogs.push(msg),
      info: vi.fn(),
    };

    const verifyResult = verifyUpdateBeforeApply({
      manifestEnvelope: envelope,
      targetDir,
      downloadStagingDir: stagingDir,
      currentInstalledVersion: '1.0.0',
      config: { keyRing, logger: mockLogger },
    });

    expect(verifyResult.allowed).toBe(false);
    expect(verifyResult.reason).toBe('digest-mismatch');
    expect(errorLogs.some((l) => l.includes('[AUDIT REFUSAL]') && l.includes('digest-mismatch'))).toBe(true);

    // Apply update should also refuse directly
    const applyResult = applyVerifiedRuntimeUpdate({
      stagedDir: stagingDir,
      targetDir,
      backupDir,
      stateFile,
      manifestEnvelope: envelope,
      keyRing,
      currentInstalledVersion: '1.0.0',
      logger: mockLogger,
    });

    expect(applyResult.success).toBe(false);
    expect(fs.readFileSync(path.join(targetDir, 'core.exe'), 'utf8')).toBe('v1.0.0-binary');
  });

  it('refuses update when version is lower than installed (anti-rollback) and logs audit entry', () => {
    const envelope = createSignedUpdate('0.9.0', {
      'core.exe': 'v0.9.0-older-binary',
      'version.txt': '0.9.0',
    });

    const errorLogs: string[] = [];
    const mockLogger = {
      warn: vi.fn(),
      error: (msg: string) => errorLogs.push(msg),
      info: vi.fn(),
    };

    const verifyResult = verifyUpdateBeforeApply({
      manifestEnvelope: envelope,
      targetDir,
      downloadStagingDir: stagingDir,
      currentInstalledVersion: '1.0.0',
      config: { keyRing, logger: mockLogger },
    });

    expect(verifyResult.allowed).toBe(false);
    expect(verifyResult.reason).toBe('rollback-violation');
    expect(errorLogs.some((l) => l.includes('[AUDIT REFUSAL]') && l.includes('rollback-violation'))).toBe(true);

    // Runtime directory must remain untouched
    expect(fs.readFileSync(path.join(targetDir, 'core.exe'), 'utf8')).toBe('v1.0.0-binary');
  });

  it('refuses unsigned update in production and ignores --allow-unsigned-dev', () => {
    const errorLogs: string[] = [];
    const mockLogger = {
      warn: vi.fn(),
      error: (msg: string) => errorLogs.push(msg),
      info: vi.fn(),
    };

    const verifyResult = verifyUpdateBeforeApply({
      manifestEnvelope: null,
      targetDir,
      downloadStagingDir: stagingDir,
      currentInstalledVersion: '1.0.0',
      config: {
        keyRing,
        logger: mockLogger,
        allowUnsignedDev: true,
        isPackaged: true, // Packaged production build MUST ignore allowUnsignedDev
      },
    });

    expect(verifyResult.allowed).toBe(false);
    expect(verifyResult.reason).toBe('missing-manifest');
    expect(errorLogs.some((l) => l.includes('[AUDIT REFUSAL]') && l.includes('missing signature envelope'))).toBe(true);
  });

  it('allows unsigned dev update only when unpackaged and explicitly configured', () => {
    const warnLogs: string[] = [];
    const mockLogger = {
      warn: (msg: string) => warnLogs.push(msg),
      error: vi.fn(),
      info: vi.fn(),
    };

    const verifyResult = verifyUpdateBeforeApply({
      manifestEnvelope: null,
      targetDir,
      downloadStagingDir: stagingDir,
      currentInstalledVersion: '1.0.0',
      config: {
        keyRing,
        logger: mockLogger,
        allowUnsignedDev: true,
        isPackaged: false, // Non-packaged dev build
      },
    });

    expect(verifyResult.allowed).toBe(true);
    expect(verifyResult.devBypassApplied).toBe(true);
    expect(warnLogs.some((l) => l.includes('UNSAFE DEV OVERRIDE'))).toBe(true);
  });

  it('recovers cleanly from locked file collision by rolling back to previous version', () => {
    const envelope = createSignedUpdate('1.2.0', {
      'core.exe': 'v1.2.0-binary',
      'locked.txt': 'new-locked-content',
    });

    // Create locked.txt in targetDir
    const lockedTargetFile = path.join(targetDir, 'locked.txt');
    fs.writeFileSync(lockedTargetFile, 'old-locked-content');
    fs.chmodSync(lockedTargetFile, 0o444);
    const errorLogs: string[] = [];
    const mockLogger = {
      warn: vi.fn(),
      error: (msg: string) => errorLogs.push(msg),
      info: vi.fn(),
    };

    try {
      const result = applyReleaseUpdate({
        manifestEnvelope: envelope,
        targetDir,
        stagingDir,
        backupDir,
        stateFile,
        keyRing,
        currentInstalledVersion: '1.0.0',
        logger: mockLogger,
      });

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      expect(result.installedVersion).toBe('1.0.0');
      expect(result.lockedFilesEncountered).toBeDefined();
      expect(result.lockedFilesEncountered?.length).toBeGreaterThan(0);

      // Core file remained old version
      expect(fs.readFileSync(path.join(targetDir, 'core.exe'), 'utf8')).toBe('v1.0.0-binary');
      expect(errorLogs.some((l) => l.includes('[AUDIT REFUSAL]'))).toBe(true);

      const state = loadRollbackState(stateFile);
      expect(state.updatePending).toBe(false);
      expect(state.currentVersion).toBe('1.0.0');
    } finally {
      try {
        fs.chmodSync(lockedTargetFile, 0o666);
      } catch {}
    }
  });

  it('performs crash recovery on startup restoring previous version if updatePending was true', () => {
    // Simulate crashed update
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'core.exe'), 'v1.0.0-backup-binary');
    fs.writeFileSync(path.join(targetDir, 'core.exe'), 'v1.1.0-corrupted-half-written');

    saveRollbackState(stateFile, {
      currentVersion: '1.0.0',
      updatePending: true,
      pendingVersion: '1.1.0',
      backupDir,
      lastSuccessfulUpdate: new Date().toISOString(),
    });

    const recovery = recoverPendingUpdate(stateFile, targetDir);
    expect(recovery.recovered).toBe(true);
    expect(recovery.restoredVersion).toBe('1.0.0');
    expect(fs.readFileSync(path.join(targetDir, 'core.exe'), 'utf8')).toBe('v1.0.0-backup-binary');

    const stateAfter = loadRollbackState(stateFile);
    expect(stateAfter.updatePending).toBe(false);
  });

  it('wires into autoUpdater events and guards quitAndInstall', () => {
    type Listener = (...args: unknown[]) => void;
    const listeners: Record<string, Listener[]> = {};
    let quitAndInstallCalled = false;

    const mockAutoUpdater: AutoUpdaterLike = {
      on: (event: string, fn: Listener) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      quitAndInstall: () => {
        quitAndInstallCalled = true;
      },
    };

    attachAutoUpdaterSecurity(mockAutoUpdater, {
      getCurrentVersion: () => '1.0.0',
      keyRing,
      stateFile,
      targetDir,
    });

    // Verify 'update-downloaded' listener was attached
    expect(listeners['update-downloaded']).toBeDefined();
    expect(listeners['update-downloaded'].length).toBeGreaterThan(0);

    // Call quitAndInstall without verified update -> should refuse and throw
    expect(() => mockAutoUpdater.quitAndInstall?.()).toThrow(/Refused update apply/);
    expect(quitAndInstallCalled).toBe(false);
    const invalidEnvelope = createSignedUpdate('1.1.0', {
      'core.exe': 'original-v1.1.0-content',
    });

    // Corrupt staging
    fs.writeFileSync(path.join(stagingDir, 'core.exe'), 'tampered');
    const downloadHandler = listeners['update-downloaded'][0];
    downloadHandler({
      version: '1.1.0',
      downloadedFile: path.join(stagingDir, 'update.zip'),
      manifestEnvelope: invalidEnvelope,
      stagingDir,
    });

    // Should still throw on quitAndInstall
    expect(() => mockAutoUpdater.quitAndInstall?.()).toThrow(/Refused update apply/);
    expect(quitAndInstallCalled).toBe(false);
  });
});
