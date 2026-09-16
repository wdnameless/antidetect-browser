import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  KeyRingStore,
  SignedManifestEnvelope,
  verifySignedManifest,
} from './signing';
import {
  applyReleaseUpdate,
  recoverPendingUpdate,
  loadRollbackState,
  SecurityLogger,
  UpdateExecutionResult,
} from './releaseVerifier';
import { isUnsignedDevAllowed } from './enforcement';

export interface UpdaterSecurityConfig {
  keyRing?: KeyRingStore;
  keyRingPath?: string;
  rollbackStatePath?: string;
  runtimeInstallDir?: string;
  runtimeBackupDir?: string;
  logger?: SecurityLogger;
  allowUnsignedDev?: boolean;
  isPackaged?: boolean;
}

export interface VerifyUpdateBeforeApplyParams {
  stagedUpdateDir?: string;
  downloadStagingDir?: string;
  targetDir?: string;
  updateArtifactPath?: string;
  manifestEnvelope?: SignedManifestEnvelope;
  manifestPath?: string;
  currentInstalledVersion: string;
  config?: UpdaterSecurityConfig;
}

export interface VerifyUpdateBeforeApplyResult {
  allowed: boolean;
  reason?: string;
  error?: string;
  devBypassApplied?: boolean;
  manifestEnvelope?: SignedManifestEnvelope;
  manifest?: SignedManifestEnvelope['payload'];
}

/**
 * Loads a keyring from file if available, or creates an empty store.
 */
export function resolveKeyRing(config?: UpdaterSecurityConfig): KeyRingStore {
  if (config?.keyRing) {
    return config.keyRing;
  }
  const candidatePath =
    config?.keyRingPath ||
    process.env.RELEASE_KEYRING_PATH ||
    path.join(__dirname, '..', '..', 'resources', 'release-keyring.json');
  if (fs.existsSync(candidatePath)) {
    try {
      return KeyRingStore.fromFile(candidatePath);
    } catch {
      // Fallback to empty keyring if corrupt
    }
  }

  return new KeyRingStore({
    version: 1,
    keys: {},
  });
}

/**
 * Extract or locate the release manifest envelope.
 * Supports:
 * 1. Explicit in-memory envelope
 * 2. Manifest file path (e.g. manifest.json or release-manifest.json)
 * 3. Sibling manifest next to update artifact: `<artifact>.manifest.json` or in staged dir
 */
export function resolveManifestEnvelope(
  params: VerifyUpdateBeforeApplyParams
): SignedManifestEnvelope | null {
  if (params.manifestEnvelope) {
    return params.manifestEnvelope;
  }

  const candidatePaths: string[] = [];
  if (params.manifestPath) {
    candidatePaths.push(params.manifestPath);
  }
  if (params.updateArtifactPath) {
    candidatePaths.push(`${params.updateArtifactPath}.manifest.json`);
    candidatePaths.push(path.join(path.dirname(params.updateArtifactPath), 'release-manifest.json'));
    candidatePaths.push(path.join(path.dirname(params.updateArtifactPath), 'manifest.json'));
  }
  if (params.stagedUpdateDir) {
    candidatePaths.push(path.join(params.stagedUpdateDir, 'release-manifest.json'));
    candidatePaths.push(path.join(params.stagedUpdateDir, 'manifest.json'));
  }

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.payload && parsed.signatures) {
          return parsed as SignedManifestEnvelope;
        }
      } catch {
        // try next
      }
    }
  }

  return null;
}

/**
 * Core security check before applying an update.
 * Verifies:
 * 1. Manifest Ed25519 signature(s) against trusted key ring.
 * 2. Artifact digests matching the staged directory / downloaded artifact.
 * 3. Monotonic anti-rollback: manifest.version must be strictly greater than currentInstalledVersion.
 * 4. Refuses update, keeps current runtime, and logs audit refusal on mismatch.
 * 5. Respects `--allow-unsigned-dev` ONLY in non-production builds (ignored in production).
 */
export function verifyUpdateBeforeApply(
  params: VerifyUpdateBeforeApplyParams
): VerifyUpdateBeforeApplyResult {
  const logger = params.config?.logger ?? console;
  const allowDev = isUnsignedDevAllowed({
    allowUnsignedDev: params.config?.allowUnsignedDev,
    isPackaged: params.config?.isPackaged,
  });

  const envelope = resolveManifestEnvelope(params);
  if (!envelope) {
    if (allowDev) {
      logger.warn('[AUDIT DEV BYPASS] UNSAFE DEV OVERRIDE: Allowing update without signed release manifest (--allow-unsigned-dev enabled in dev mode).');
      return {
        allowed: true,
        devBypassApplied: true,
        reason: 'dev-bypass',
      };
    }
    logger.error('[AUDIT REFUSAL] Refused update apply: missing signature envelope.');
    return {
      allowed: false,
      reason: 'missing-manifest',
      error: 'Update rejected: missing signature envelope.',
      devBypassApplied: false,
    };
  }

  const keyRing = resolveKeyRing(params.config);

  // If a single file artifact was provided and manifest describes it
  if (params.updateArtifactPath && fs.existsSync(params.updateArtifactPath) && !params.stagedUpdateDir) {
    const artifactFilename = path.basename(params.updateArtifactPath);
    const targetDir = path.dirname(params.updateArtifactPath);

    const verification = verifySignedManifest(envelope, keyRing, {
      targetDir,
      currentInstalledVersion: params.currentInstalledVersion,
      allowRollback: false,
    });

    if (!verification.valid) {
      if (allowDev) {
        logger.warn(`[AUDIT DEV BYPASS] Allowing invalid/tampered update artifact: ${verification.reason} (--allow-unsigned-dev enabled in dev mode).`);
        return {
          allowed: true,
          devBypassApplied: true,
          reason: 'dev-bypass',
          manifestEnvelope: envelope,
        };
      }

      logger.error(`[AUDIT REFUSAL] Refused update artifact '${artifactFilename}': ${verification.reason} - ${verification.error}`);
      return {
        allowed: false,
        reason: verification.reason,
        error: verification.error,
        devBypassApplied: false,
        manifestEnvelope: envelope,
      };
    }

    return {
      allowed: true,
      manifestEnvelope: envelope,
    };
  }

  // Staged directory verification
  const stagingDirectory = params.stagedUpdateDir || params.downloadStagingDir;
  // Staged directory verification
  const verification = verifySignedManifest(envelope, keyRing, {
    targetDir: stagingDirectory,
    currentInstalledVersion: params.currentInstalledVersion,
    allowRollback: false,
  });

  if (!verification.valid) {
    if (allowDev) {
      logger.warn(`[AUDIT DEV BYPASS] Allowing invalid/tampered staged update: ${verification.reason} (--allow-unsigned-dev enabled in dev mode).`);
      return {
        allowed: true,
        devBypassApplied: true,
        reason: 'dev-bypass',
        manifestEnvelope: envelope,
        manifest: envelope.payload,
      };
    }

    logger.error(`[AUDIT REFUSAL] Refused update apply for version '${envelope.payload.version}' (current: '${params.currentInstalledVersion}'): ${verification.reason} - ${verification.error}`);
    return {
      allowed: false,
      reason: verification.reason,
      error: verification.error,
      devBypassApplied: false,
      manifestEnvelope: envelope,
      manifest: envelope.payload,
    };
  }

  return {
    allowed: true,
    manifestEnvelope: envelope,
    manifest: envelope.payload,
  };
}

/**
 * Execute verified runtime update with atomic rollback tracking and crash recovery.
 */
export function applyVerifiedRuntimeUpdate(params: {
  stagedDir: string;
  targetDir: string;
  backupDir: string;
  stateFile: string;
  manifestEnvelope: SignedManifestEnvelope;
  currentInstalledVersion: string;
  keyRing?: KeyRingStore;
  logger?: SecurityLogger;
  allowUnsignedDev?: boolean;
  isPackaged?: boolean;
}): UpdateExecutionResult {
  const logger = params.logger ?? console;

  // First verify before applying
  const verification = verifyUpdateBeforeApply({
    stagedUpdateDir: params.stagedDir,
    manifestEnvelope: params.manifestEnvelope,
    currentInstalledVersion: params.currentInstalledVersion,
    config: {
      keyRing: params.keyRing,
      logger,
      allowUnsignedDev: params.allowUnsignedDev,
      isPackaged: params.isPackaged,
    },
  });

  if (!verification.allowed) {
    return {
      success: false,
      installedVersion: params.currentInstalledVersion,
      error: verification.error || `Update refused: ${verification.reason}`,
    };
  }

  const keyRing = params.keyRing ?? resolveKeyRing({ logger });

  return applyReleaseUpdate({
    manifestEnvelope: params.manifestEnvelope,
    targetDir: params.targetDir,
    stagingDir: params.stagedDir,
    backupDir: params.backupDir,
    stateFile: params.stateFile,
    keyRing,
    currentInstalledVersion: params.currentInstalledVersion,
    logger,
  });
}

