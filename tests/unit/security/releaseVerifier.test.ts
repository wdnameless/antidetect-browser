import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  applyReleaseUpdate,
  loadRollbackState,
  saveRollbackState,
  recoverPendingUpdate,
  verifyReleaseManifest,
} from '../../../src/main/security/releaseVerifier';
import {
  generateEd25519KeyPair,
  createSignedManifest,
  buildDirectoryMd5Manifest,
  KeyRingStore,
} from '../../../src/main/security/signing';
describe('Release Verifier & Rollback Recovery', () => {
  let tmpBase: string;
  let targetDir: string;
  let stagingDir: string;
  let backupDir: string;
  let stateFile: string;
  let keyRing: KeyRingStore;
  let keyPair: { publicKeyPem: string; privateKeyPem: string };

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-release-test-'));
    targetDir = path.join(tmpBase, 'target');
    stagingDir = path.join(tmpBase, 'staging');
    backupDir = path.join(tmpBase, 'backup');
    stateFile = path.join(tmpBase, 'rollback-state.json');

    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    // Initial files in target
    fs.writeFileSync(path.join(targetDir, 'core.dll'), 'original-v1.0.0', 'utf8');

    keyPair = generateEd25519KeyPair();
    keyRing = new KeyRingStore();
    keyRing.addKey({
      keyId: 'release-key',
      publicKeyPem: keyPair.publicKeyPem,
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    if (fs.existsSync(tmpBase)) {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('applies a verified release update successfully', () => {
    // Stage v1.1.0 in stagingDir
    fs.writeFileSync(path.join(stagingDir, 'core.dll'), 'updated-v1.1.0', 'utf8');
    const manifestFiles = buildDirectoryMd5Manifest(stagingDir);

    const envelope = createSignedManifest({
      version: '1.1.0',
      files: manifestFiles,
      keyId: 'release-key',
      privateKeyPem: keyPair.privateKeyPem,
    });

    const result = applyReleaseUpdate({
      manifestEnvelope: envelope,
      targetDir,
      stagingDir,
      backupDir,
      stateFile,
      keyRing,
      currentInstalledVersion: '1.0.0',
    });

    expect(result.success).toBe(true);
    expect(result.installedVersion).toBe('1.1.0');
    expect(fs.readFileSync(path.join(targetDir, 'core.dll'), 'utf8')).toBe('updated-v1.1.0');

    const state = loadRollbackState(stateFile);
    expect(state.currentVersion).toBe('1.1.0');
    expect(state.updatePending).toBe(false);
  });

  it('rejects update and aborts when manifest signature or files are tampered', () => {
    fs.writeFileSync(path.join(stagingDir, 'core.dll'), 'updated-v1.1.0', 'utf8');
    const manifestFiles = buildDirectoryMd5Manifest(stagingDir);

    const envelope = createSignedManifest({
      version: '1.1.0',
      files: manifestFiles,
      keyId: 'release-key',
      privateKeyPem: keyPair.privateKeyPem,
    });

    // Tamper staging file after manifest creation
    fs.writeFileSync(path.join(stagingDir, 'core.dll'), 'malicious-injected-bytes', 'utf8');

    const result = applyReleaseUpdate({
      manifestEnvelope: envelope,
      targetDir,
      stagingDir,
      backupDir,
      stateFile,
      keyRing,
      currentInstalledVersion: '1.0.0',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('digest-mismatch');
    // Original file intact
    expect(fs.readFileSync(path.join(targetDir, 'core.dll'), 'utf8')).toBe('original-v1.0.0');
  });

  it('recovers from interrupted / pending update on crash via recoverPendingUpdate', () => {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'core.dll'), 'original-v1.0.0-content');
    fs.writeFileSync(path.join(targetDir, 'core.dll'), 'half-copied-corrupt');

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

    // Confirms targetDir was restored from backup
    expect(fs.readFileSync(path.join(targetDir, 'core.dll'), 'utf8')).toBe('original-v1.0.0-content');

    const stateAfter = loadRollbackState(stateFile);
    expect(stateAfter.updatePending).toBe(false);
  });
});
