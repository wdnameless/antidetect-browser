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

/**
 * Hook to attach release verification and crash recovery into electron-updater's autoUpdater.
 */
export interface AutoUpdaterLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on?: (event: any, listener: (...args: any[]) => void) => any;
  quitAndInstall?: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
}

/**
 * Hook to attach release verification and crash recovery into electron-updater's autoUpdater.
 */
export function attachAutoUpdaterSecurity(
  autoUpdaterInstance: AutoUpdaterLike,
  options?: {
    getCurrentVersion?: () => string;
    keyRing?: KeyRingStore;
    stateFile?: string;
    targetDir?: string;
    logger?: SecurityLogger;
    allowUnsignedDev?: boolean;
    isPackaged?: boolean;
    onVerificationFailure?: (result: VerifyUpdateBeforeApplyResult) => void;
  }
): void {
  const logger = options?.logger ?? console;

  // 1. Startup crash/interrupted update recovery
  if (options?.stateFile && options?.targetDir) {
    try {
      const recovery = recoverPendingUpdate(options.stateFile, options.targetDir);
      if (recovery.recovered) {
        logger.warn(`[SECURITY RECOVERY] Crash recovery restored previous version '${recovery.restoredVersion}' from interrupted update.`);
      }
    } catch (err: unknown) {
      logger.error(`[SECURITY RECOVERY ERROR] Failed to run crash recovery: ${(err as Error).message}`);
    }
  }

  // 2. Intercept quitAndInstall
  const originalQuitAndInstall = autoUpdaterInstance.quitAndInstall?.bind(autoUpdaterInstance);
  let latestVerifiedUpdate: { allowed: boolean; version?: string; error?: string } = {
    allowed: false,
  };

  // 3. Listen to update-downloaded
  if (typeof autoUpdaterInstance.on === 'function') {
    autoUpdaterInstance.on('update-downloaded', (...args: unknown[]) => {
      const eventOrInfo = args[0] as Record<string, unknown> | undefined;
      const infoVersion = typeof eventOrInfo?.version === 'string' ? eventOrInfo.version : undefined;
      const downloadedFile = typeof eventOrInfo?.downloadedFile === 'string' ? eventOrInfo.downloadedFile : undefined;
      const currentVersion = options?.getCurrentVersion?.() ?? (process.env.APP_VERSION || '0.0.0');

      const verification = verifyUpdateBeforeApply({
        updateArtifactPath: downloadedFile,
        currentInstalledVersion: currentVersion,
        config: {
          keyRing: options?.keyRing,
          logger,
          allowUnsignedDev: options?.allowUnsignedDev,
          isPackaged: options?.isPackaged,
        },
      });

      if (!verification.allowed) {
        latestVerifiedUpdate = {
          allowed: false,
          version: infoVersion,
          error: verification.error,
        };
        logger.error(`[AUDIT REFUSAL] autoUpdater download rejected by supply-chain policy: ${verification.reason}`);
        options?.onVerificationFailure?.(verification);
      } else {
        latestVerifiedUpdate = {
          allowed: true,
          version: infoVersion,
        };
      }
    });
  }

  // Intercept quitAndInstall to prevent applying tampered or unverified updates
  if (originalQuitAndInstall) {
    autoUpdaterInstance.quitAndInstall = function (isSilent?: boolean, isForceRunAfter?: boolean) {
      if (!latestVerifiedUpdate.allowed) {
        const err = new Error(
          `Refused update apply: ${latestVerifiedUpdate.error ?? 'downloaded update failed manifest verification or was not verified'}`
        );
        logger.error(`[AUDIT REFUSAL] Prevented quitAndInstall: ${err.message}`);
        throw err;
      }
      return originalQuitAndInstall(isSilent, isForceRunAfter);
    };
  }
}

export interface AttachSecureUpdaterOptions {
  currentInstalledVersion?: string;
  getCurrentVersion?: () => string;
  keyRing?: KeyRingStore;
  stateFile?: string;
  targetDir?: string;
  logger?: SecurityLogger;
  allowUnsignedDev?: boolean;
  isPackaged?: boolean;
  onVerificationFailure?: (result: { reason: string; error?: string }) => void;
}

/**
 * Backward compatible alias for attachAutoUpdaterSecurity with onVerificationFailure callback.
 */
export function attachSecureUpdater(
  autoUpdaterInstance: AutoUpdaterLike,
  options?: AttachSecureUpdaterOptions
): void {
  const getVersion = options?.getCurrentVersion ?? (() => options?.currentInstalledVersion ?? '0.0.0');
  const { onVerificationFailure, ...rest } = options ?? {};
  attachAutoUpdaterSecurity(autoUpdaterInstance, {
    ...rest,
    getCurrentVersion: getVersion,
    onVerificationFailure: onVerificationFailure
      ? (res) => onVerificationFailure({ reason: res.reason ?? 'verification-failed', error: res.error })
      : undefined,
  });
  if (options?.onVerificationFailure && autoUpdaterInstance.on) {
    autoUpdaterInstance.on('update-verification-failed', (err: unknown) => {
      const e = err as { reason?: string; error?: string };
      options.onVerificationFailure?.({
        reason: e?.reason ?? 'verification-failed',
        error: e?.error ?? String(err),
      });
    });
  }
}
