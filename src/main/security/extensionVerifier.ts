import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  generateEd25519KeyPair,
  buildDirectoryMd5Manifest,
  createSignedManifest,
  KeyRingStore,
  KeyPairPem,
  SignedManifestEnvelope,
} from './signing';
import {
  verifyStealthExtension,
  ArtifactVerificationResult,
  SecurityPolicyOptions,
} from './enforcement';

export class StealthExtensionVerificationError extends Error {
  public readonly profileId?: string;
  public readonly artifactPath: string;
  public readonly verificationResult?: ArtifactVerificationResult;

  constructor(
    message: string,
    options: {
      profileId?: string;
      artifactPath: string;
      verificationResult?: ArtifactVerificationResult;
    }
  ) {
    super(message);
    this.name = 'StealthExtensionVerificationError';
    this.profileId = options.profileId;
    this.artifactPath = options.artifactPath;
    this.verificationResult = options.verificationResult;
    Object.setPrototypeOf(this, StealthExtensionVerificationError.prototype);
  }
}

export function computeKeyIdFromPublicPem(pem: string): string {
  return crypto.createHash('sha256').update(pem).digest('hex').slice(0, 16);
}

let ephemeralStealthKeyPair: KeyPairPem | null = null;
let ephemeralStealthKeyRing: KeyRingStore | null = null;

/**
 * Returns a process-lived Ephemeral KeyPair used for signing runtime generated stealth extensions.
 */
export function getEphemeralStealthKeyPair(): KeyPairPem {
  if (!ephemeralStealthKeyPair) {
    ephemeralStealthKeyPair = generateEd25519KeyPair();
    const keyId = computeKeyIdFromPublicPem(ephemeralStealthKeyPair.publicKeyPem);
    ephemeralStealthKeyRing = new KeyRingStore({
      version: 1,
      defaultKeyId: keyId,
      keys: {
        [keyId]: {
          keyId,
          publicKeyPem: ephemeralStealthKeyPair.publicKeyPem,
          createdAt: new Date().toISOString(),
          comment: 'ephemeral-stealth-key',
        },
      },
    });
  }
  return ephemeralStealthKeyPair;
}

/**
 * Returns the KeyRingStore containing the ephemeral stealth public key.
 */
export function getEphemeralStealthKeyRing(): KeyRingStore {
  if (!ephemeralStealthKeyRing) {
    getEphemeralStealthKeyPair();
  }
  return ephemeralStealthKeyRing!;
}

/**
 * Sets or overrides the KeyRingStore used for stealth extension verification (useful in tests).
 */
export function setEphemeralStealthKeyRing(keyRing: KeyRingStore | null): void {
  ephemeralStealthKeyRing = keyRing;
}

/**
 * Sign an on-disk stealth extension directory.
 * Generates an Ed25519 signature over MD5 file entries and writes stealth-manifest.sig.json.
 */
export function signStealthExtension(
  extensionDir: string,
  keyPair: KeyPairPem,
  version: string = '1.0.0'
): SignedManifestEnvelope {
  const keyId = computeKeyIdFromPublicPem(keyPair.publicKeyPem);
  const files = buildDirectoryMd5Manifest(extensionDir);
  const envelope = createSignedManifest({
    version,
    files,
    keyId,
    privateKeyPem: keyPair.privateKeyPem,
  });
  const sigPath = path.join(extensionDir, 'stealth-manifest.sig.json');
  fs.writeFileSync(sigPath, JSON.stringify(envelope, null, 2), 'utf8');
  return envelope;
}

/**
 * Read the signed manifest envelope from an extension directory, if present.
 */
export function readStealthManifestEnvelope(
  extensionDir: string
): SignedManifestEnvelope | null {
  const sigPath = path.join(extensionDir, 'stealth-manifest.sig.json');
  if (!fs.existsSync(sigPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(sigPath, 'utf8');
    return JSON.parse(content) as SignedManifestEnvelope;
  } catch {
    return null;
  }
}

export interface VerifyStealthOptions {
  profileId?: string;
  keyRing?: KeyRingStore;
  policyOpts?: SecurityPolicyOptions;
}

/**
 * Verify stealth extension artifact integrity before Chrome launch.
 * Fails closed throwing StealthExtensionVerificationError if missing, unsigned, or tampered.
 */
export function verifyStealthExtensionDirectory(
  extensionDir: string,
  options?: VerifyStealthOptions
): ArtifactVerificationResult {
  const envelope = readStealthManifestEnvelope(extensionDir);
  const keyRing = options?.keyRing ?? getEphemeralStealthKeyRing();
  const profileId = options?.profileId ?? 'unknown-profile';

  const result = verifyStealthExtension(
    profileId,
    extensionDir,
    envelope,
    keyRing,
    options?.policyOpts
  );

  if (!result.allowed) {
    const remediation =
      `Security Remediation Required: Stealth extension verification failed for profile '${profileId}'. ` +
      `Artifact at '${extensionDir}' is ${result.reason || 'unverified'}. Launch aborted to prevent malicious script injection.`;
    throw new StealthExtensionVerificationError(remediation, {
      profileId,
      artifactPath: extensionDir,
      verificationResult: result,
    });
  }

  return result;
}

// Backwards compatibility / convenience alias
export const verifyStealthExtensionArtifact = verifyStealthExtensionDirectory;
