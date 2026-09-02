import * as fs from 'fs';
import * as path from 'path';
import {
  SignedManifestEnvelope,
  VerificationResult,
  verifySignedManifest,
  KeyRingStore,
  computeFileMd5,
} from './signing';
let defaultKeyRingInstance: KeyRingStore | null = null;

export function getDefaultKeyRing(): KeyRingStore {
  if (!defaultKeyRingInstance) {
    defaultKeyRingInstance = new KeyRingStore();
  }
  return defaultKeyRingInstance;
}

export function setDefaultKeyRing(ring: KeyRingStore): void {
  defaultKeyRingInstance = ring;
}


export interface SecurityPolicyOptions {
  allowUnsignedDev?: boolean;
  isPackaged?: boolean;
  logger?: {
    warn: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
  };
}

export interface ArtifactVerificationResult {
  allowed: boolean;
  devBypassApplied: boolean;
  reason: string;
  auditRecord?: {
    artifactType: 'script' | 'extension' | 'runtime-module';
    identifier: string;
    action: 'allow' | 'deny';
    devBypass: boolean;
    reason: string;
    timestamp: string;
    mismatchedFiles?: string[];
  };
}

/**
 * Determine whether allowUnsignedDev flag can be honored.
 * CRITICAL RULE: Production / packaged builds MUST IGNORE --allow-unsigned-dev.
 */
export function isUnsignedDevAllowed(opts?: {
  allowUnsignedDev?: boolean;
  isPackaged?: boolean;
}): boolean {
  // Check electron app.isPackaged dynamically if opts.isPackaged is not provided
  let electronPackaged: boolean | undefined = undefined;
  if (opts?.isPackaged === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      if (electron?.app?.isPackaged !== undefined) {
        electronPackaged = electron.app.isPackaged;
      }
    } catch {
      // Not running in Electron environment or not available
    }
  }

  // If explicitly packaged or running in production NODE_ENV, always false
  const isProd =
    opts?.isPackaged === true ||
    electronPackaged === true ||
    process.env.NODE_ENV === 'production';
  if (isProd) {
    return false;
  }

  // Check command line arguments if not passed in opts
  const flagInArgs = process.argv.includes('--allow-unsigned-dev');
  return Boolean(opts?.allowUnsignedDev || flagInArgs);
}

/**
 * Verifier for script engine modules before execution.
 * Fails closed in production if signature is missing or tampered.
 * Writes audit log entry.
 */
export function verifyScriptModule(
  moduleId: string,
  moduleDirOrFiles: string,
  manifestEnvelope: SignedManifestEnvelope | null,
  keyRing: KeyRingStore,
  policyOpts?: SecurityPolicyOptions
): ArtifactVerificationResult {
  const allowDev = isUnsignedDevAllowed(policyOpts);
  const logger = policyOpts?.logger ?? console;

  if (!manifestEnvelope) {
    if (allowDev) {
      logger.warn(`[SECURITY WARNING] Allowing unsigned script module '${moduleId}' due to --allow-unsigned-dev escape hatch.`);
      return {
        allowed: true,
        devBypassApplied: true,
        reason: 'unsigned-dev-override',
        auditRecord: {
          artifactType: 'script',
          identifier: moduleId,
          action: 'allow',
          devBypass: true,
          reason: 'unsigned-dev-override',
          timestamp: new Date().toISOString(),
        },
      };
    }

    logger.error(`[AUDIT REFUSAL] Refused execution of unsigned script module '${moduleId}': missing signature envelope.`);
    return {
      allowed: false,
      devBypassApplied: false,
      reason: 'missing-signature',
      auditRecord: {
        artifactType: 'script',
        identifier: moduleId,
        action: 'deny',
        devBypass: false,
        reason: 'missing-signature',
        timestamp: new Date().toISOString(),
      },
    };
  }
  // Verify against target dir if moduleDirOrFiles is provided
  let targetDir: string | undefined;
  if (fs.existsSync(moduleDirOrFiles)) {
    const st = fs.statSync(moduleDirOrFiles);
    if (st.isDirectory()) {
      targetDir = moduleDirOrFiles;
    } else if (st.isFile()) {
      targetDir = path.dirname(moduleDirOrFiles);
    }
  }

  const result = verifySignedManifest(manifestEnvelope, keyRing, { targetDir });

  if (result.valid) {
    return {
      allowed: true,
      devBypassApplied: false,
      reason: 'signature-verified',
      auditRecord: {
        artifactType: 'script',
        identifier: moduleId,
        action: 'allow',
        devBypass: false,
        reason: 'signature-verified',
        timestamp: new Date().toISOString(),
      },
    };
  }

  // Verification failed
  if (allowDev) {
    logger.warn(`[SECURITY WARNING] Allowing invalid/tampered script module '${moduleId}' due to --allow-unsigned-dev (${result.reason}: ${result.error}).`);
    return {
      allowed: true,
      devBypassApplied: true,
      reason: `tampered-dev-override:${result.reason}`,
      auditRecord: {
        artifactType: 'script',
        identifier: moduleId,
        action: 'allow',
        devBypass: true,
        reason: `tampered-dev-override:${result.reason}`,
        timestamp: new Date().toISOString(),
        mismatchedFiles: result.mismatchedFiles,
      },
    };
  }

  logger.error(`[AUDIT REFUSAL] Refused execution of tampered/invalid script module '${moduleId}': ${result.reason} - ${result.error}`);
  return {
    allowed: false,
    devBypassApplied: false,
    reason: result.reason || 'verification-failed',
    auditRecord: {
      artifactType: 'script',
      identifier: moduleId,
      action: 'deny',
      devBypass: false,
      reason: result.reason || 'verification-failed',
      timestamp: new Date().toISOString(),
      mismatchedFiles: result.mismatchedFiles,
    },
  };
}

/**
 * Verifier for stealth-extension artifacts at profile launch.
 * Fails closed with remediation error.
 */
export function verifyStealthExtension(
  extensionId: string,
  extensionDir: string,
  manifestEnvelope: SignedManifestEnvelope | null,
  keyRing: KeyRingStore,
  policyOpts?: SecurityPolicyOptions
): ArtifactVerificationResult {
  const allowDev = isUnsignedDevAllowed(policyOpts);
  const logger = policyOpts?.logger ?? console;

  if (!manifestEnvelope) {
    if (allowDev) {
      logger.warn(`[SECURITY WARNING] Stealth extension '${extensionId}' loaded unsigned via --allow-unsigned-dev.`);
      return {
        allowed: true,
        devBypassApplied: true,
        reason: 'unsigned-dev-override',
      };
    }

    const remediation = `Stealth extension '${extensionId}' lacks an authentic signature. Re-download verified extension package or run with valid signature.`;
    logger.error(`[SECURITY FAILURE] ${remediation}`);
    return {
      allowed: false,
      devBypassApplied: false,
      reason: 'missing-signature',
      auditRecord: {
        artifactType: 'extension',
        identifier: extensionId,
        action: 'deny',
        devBypass: false,
        reason: remediation,
        timestamp: new Date().toISOString(),
      },
    };
  }

  const result = verifySignedManifest(manifestEnvelope, keyRing, { targetDir: extensionDir });

  if (result.valid) {
    return {
      allowed: true,
      devBypassApplied: false,
      reason: 'signature-verified',
    };
  }

  if (allowDev) {
    logger.warn(`[SECURITY WARNING] Stealth extension '${extensionId}' failed verification (${result.reason}), permitted by --allow-unsigned-dev.`);
    return {
      allowed: true,
      devBypassApplied: true,
      reason: `tampered-dev-override:${result.reason}`,
    };
  }

  const remediation = `Stealth extension '${extensionId}' integrity verification failed (${result.reason}: ${result.error}). Artifacts may have been tampered.`;
  logger.error(`[SECURITY FAILURE] ${remediation}`);
  return {
    allowed: false,
    devBypassApplied: false,
    reason: result.reason || 'verification-failed',
    auditRecord: {
      artifactType: 'extension',
      identifier: extensionId,
      action: 'deny',
      devBypass: false,
      reason: remediation,
      timestamp: new Date().toISOString(),
      mismatchedFiles: result.mismatchedFiles,
    },
  };
}
