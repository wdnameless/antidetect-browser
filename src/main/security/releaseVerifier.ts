import * as fs from 'fs';
import * as path from 'path';
import {
  SignedManifestEnvelope,
  VerificationResult,
  verifySignedManifest,
  KeyRingStore,
  buildDirectoryMd5Manifest,
  createSignedManifest,
} from './signing';

export interface RollbackState {
  currentVersion: string;
  previousVersion?: string;
  lastSuccessfulUpdate: string;
  updatePending?: boolean;
  pendingVersion?: string;
  backupDir?: string;
  stateChecksum?: string;
}

export interface SecurityLogger {
  warn: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

export interface ReleaseUpdateOptions {
  manifestEnvelope: SignedManifestEnvelope;
  targetDir: string;
  stagingDir: string;
  backupDir: string;
  stateFile: string;
  keyRing: KeyRingStore;
  currentInstalledVersion: string;
  allowRollback?: boolean;
  logger?: SecurityLogger;
}

export interface UpdateExecutionResult {
  success: boolean;
  installedVersion: string;
  rolledBack?: boolean;
  lockedFilesEncountered?: string[];
  error?: string;
}

/**
 * Verifier function for release manifests.
 */
export function verifyReleaseManifest(
  envelope: SignedManifestEnvelope,
  keyRing: KeyRingStore,
  targetDir: string,
  currentInstalledVersion: string,
  logger?: SecurityLogger
): VerificationResult {
  const result = verifySignedManifest(envelope, keyRing, {
    targetDir,
    currentInstalledVersion,
    allowRollback: false,
  });
  if (!result.valid) {
    const log = logger ?? console;
    log.error(`[AUDIT REFUSAL] Release manifest verification failed: ${result.reason} - ${result.error ?? 'unknown error'}`);
  }
  return result;
}

/**
 * Safely copies directory recursively, handling locked files by recording them.
 */
function copyDirRecursiveWithLockedTracking(
  src: string,
  dest: string,
  lockedFiles: string[]
): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursiveWithLockedTracking(srcPath, destPath, lockedFiles);
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err: unknown) {
        // EBUSY or EPERM indicates locked file
        const e = err as { code?: string };
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
          lockedFiles.push(destPath);
        } else {
          throw err;
        }
      }
    }
  }
}

/**
 * Load rollback state file.
 */
export function loadRollbackState(stateFile: string): RollbackState {
  if (!fs.existsSync(stateFile)) {
    return {
      currentVersion: '0.0.0',
      lastSuccessfulUpdate: new Date().toISOString(),
    };
  }
  try {
    const content = fs.readFileSync(stateFile, 'utf8');
    return JSON.parse(content) as RollbackState;
  } catch {
    return {
      currentVersion: '0.0.0',
      lastSuccessfulUpdate: new Date().toISOString(),
    };
  }
}

/**
 * Save rollback state file with atomic write.
 */
export function saveRollbackState(stateFile: string, state: RollbackState): void {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = `${stateFile}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpFile, stateFile);
}

/**
 * Crash and locked-file recovery: checks if an update was left pending or locked.
 * If pending update was interrupted, attempts recovery by restoring backupDir.
 */
export function recoverPendingUpdate(
  stateFile: string,
  targetDir: string
): { recovered: boolean; restoredVersion?: string; error?: string } {
  const state = loadRollbackState(stateFile);
  if (!state.updatePending) {
    return { recovered: false };
  }

  if (state.backupDir && fs.existsSync(state.backupDir)) {
    const lockedFiles: string[] = [];
    try {
      copyDirRecursiveWithLockedTracking(state.backupDir, targetDir, lockedFiles);
      state.updatePending = false;
      state.pendingVersion = undefined;
      state.backupDir = undefined;
      saveRollbackState(stateFile, state);
      return { recovered: true, restoredVersion: state.currentVersion };
    } catch (err: unknown) {
      const e = err as Error;
      return { recovered: false, error: e.message };
    }
  }

  // Clear pending state if no backup exists
  state.updatePending = false;
  state.pendingVersion = undefined;
  saveRollbackState(stateFile, state);
  return { recovered: false };
}

/**
 * Apply runtime release update with verification, atomic backup, rollback on locked-file/verification failure.
 */
export function applyReleaseUpdate(options: ReleaseUpdateOptions): UpdateExecutionResult {
  const {
    manifestEnvelope,
    targetDir,
    stagingDir,
    backupDir,
    stateFile,
    keyRing,
    currentInstalledVersion,
    logger,
  } = options;
  const log = logger ?? console;

  // 1. Verify manifest envelope and staged files first
  const verification = verifySignedManifest(manifestEnvelope, keyRing, {
    targetDir: stagingDir,
    currentInstalledVersion,
    allowRollback: options.allowRollback ?? false,
  });

  if (!verification.valid) {
    log.error(`[AUDIT REFUSAL] Refused release update to '${manifestEnvelope.payload.version}' (current: '${currentInstalledVersion}'): ${verification.reason} - ${verification.error}`);
    return {
      success: false,
      installedVersion: currentInstalledVersion,
      error: `Manifest verification failed: ${verification.reason} - ${verification.error}`,
    };
  }

  // 2. Initialize rollback state as pending
  const rollbackState = loadRollbackState(stateFile);
  if (!rollbackState.currentVersion || rollbackState.currentVersion === '0.0.0') {
    rollbackState.currentVersion = currentInstalledVersion;
  }
  rollbackState.updatePending = true;
  rollbackState.pendingVersion = manifestEnvelope.payload.version;
  rollbackState.backupDir = backupDir;
  saveRollbackState(stateFile, rollbackState);

  // 3. Backup current targetDir
  const backupLocked: string[] = [];
  if (fs.existsSync(targetDir)) {
    copyDirRecursiveWithLockedTracking(targetDir, backupDir, backupLocked);
  }

  // 4. Copy staged files to targetDir
  const applyLockedFiles: string[] = [];
  try {
    copyDirRecursiveWithLockedTracking(stagingDir, targetDir, applyLockedFiles);

    if (applyLockedFiles.length > 0) {
      // Encountered locked files during update, roll back from backup
      copyDirRecursiveWithLockedTracking(backupDir, targetDir, []);
      rollbackState.updatePending = false;
      rollbackState.pendingVersion = undefined;
      saveRollbackState(stateFile, rollbackState);

      log.error(`[AUDIT REFUSAL] Refused release update due to ${applyLockedFiles.length} locked files. Rolled back to '${currentInstalledVersion}'. Files: ${applyLockedFiles.join(', ')}`);
      return {
        success: false,
        installedVersion: currentInstalledVersion,
        rolledBack: true,
        lockedFilesEncountered: applyLockedFiles,
        error: `Encountered ${applyLockedFiles.length} locked files during installation. Rolled back.`,
      };
    }

    // 5. Final integrity check on targetDir
    const finalCheck = verifySignedManifest(manifestEnvelope, keyRing, {
      targetDir,
      currentInstalledVersion,
    });

    if (!finalCheck.valid) {
      log.error(`[AUDIT REFUSAL] Final verification failed on target directory: ${finalCheck.reason} - ${finalCheck.error}. Rolled back to '${currentInstalledVersion}'.`);
      // Integrity check failed post-copy, restore backup
      copyDirRecursiveWithLockedTracking(backupDir, targetDir, []);
      rollbackState.updatePending = false;
      saveRollbackState(stateFile, rollbackState);

      return {
        success: false,
        installedVersion: currentInstalledVersion,
        rolledBack: true,
        error: `Final verification failed on target directory: ${finalCheck.reason}`,
      };
    }

    // 6. Update succeeded
    rollbackState.updatePending = false;
    rollbackState.previousVersion = rollbackState.currentVersion;
    rollbackState.currentVersion = manifestEnvelope.payload.version;
    rollbackState.lastSuccessfulUpdate = new Date().toISOString();
    rollbackState.pendingVersion = undefined;
    rollbackState.backupDir = undefined;
    saveRollbackState(stateFile, rollbackState);

    return {
      success: true,
      installedVersion: manifestEnvelope.payload.version,
    };
  } catch (err: unknown) {
    const e = err as Error;
    log.error(`[AUDIT REFUSAL] Release update exception: ${e.message}. Attempting rollback to '${currentInstalledVersion}'.`);
    // Attempt automatic rollback
    if (fs.existsSync(backupDir)) {
      try {
        copyDirRecursiveWithLockedTracking(backupDir, targetDir, []);
      } catch {
        // preserve original error
      }
    }
    rollbackState.updatePending = false;
    saveRollbackState(stateFile, rollbackState);

    return {
      success: false,
      installedVersion: currentInstalledVersion,
      rolledBack: true,
      error: `Update failure: ${e.message}`,
    };
  }
}
