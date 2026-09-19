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
import { getStealthKeyRing, hasPersistedStealthKey } from './stealthKey';
import { DATA_DIR } from '../config';

/** The signed envelope's own filename inside an extension directory. */
export const STEALTH_SIG_FILENAME = 'stealth-manifest.sig.json';

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
 * Returns a keyring containing the ephemeral stealth public key.
 *
 * This rebuilds the ring from the pair whenever the ring is absent. It used to return
 * `ephemeralStealthKeyRing!` after calling `getEphemeralStealthKeyPair()`, which only builds a
 * ring when it also builds the pair — so after `setEphemeralStealthKeyRing(null)` (what every
 * test's `afterEach` does) the pair still existed, the ring was never rebuilt, and this returned
 * `null` behind a non-null assertion, so a caller touching the returned ring hit a TypeError
 * instead of verifying anything.
 */
export function getEphemeralStealthKeyRing(): KeyRingStore {
  if (!ephemeralStealthKeyRing) {
    const keyPair = getEphemeralStealthKeyPair();
    const keyId = computeKeyIdFromPublicPem(keyPair.publicKeyPem);
    ephemeralStealthKeyRing = new KeyRingStore({
      version: 1,
      defaultKeyId: keyId,
      keys: {
        [keyId]: {
          keyId,
          publicKeyPem: keyPair.publicKeyPem,
          createdAt: new Date().toISOString(),
          comment: 'ephemeral-stealth-key',
        },
      },
    });
  }
  return ephemeralStealthKeyRing;
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
  // The envelope must not list itself: see `buildDirectoryMd5Manifest`'s `exclude`.
  const files = buildDirectoryMd5Manifest(extensionDir, [STEALTH_SIG_FILENAME]);
  const envelope = createSignedManifest({
    version,
    files,
    keyId,
    privateKeyPem: keyPair.privateKeyPem,
  });
  const sigPath = path.join(extensionDir, STEALTH_SIG_FILENAME);
  fs.writeFileSync(sigPath, JSON.stringify(envelope, null, 2), 'utf8');
  return envelope;
}

/**
 * Read the signed manifest envelope from an extension directory, if present.
 */
export function readStealthManifestEnvelope(
  extensionDir: string
): SignedManifestEnvelope | null {
  const sigPath = path.join(extensionDir, STEALTH_SIG_FILENAME);
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
  const profileId = options?.profileId ?? 'unknown-profile';

  // The keyring an installation trusts is built from its own persisted signing key. The
  // ephemeral pair is added as a second trusted key because the test suites sign with it and a
  // signed artifact must verify in the same process that signed it.
  //
  // Both are registered as entries in ONE ring. Merging into whichever store is the cache is
  // wrong: `getStealthKeyRing` memoises per data directory, so writing the ephemeral public key
  // into it would hand every later verification a ring that trusts a key no artifact on disk was
  // signed with. Trust is per-verification, so it is assembled here.
  const ring = new KeyRingStore();
  for (const entry of getStealthKeyRing(DATA_DIR).getAllKeys()) ring.addKey(entry);
  for (const entry of getEphemeralStealthKeyRing().getAllKeys()) {
    if (!ring.getKey(entry.keyId)) ring.addKey(entry);
  }
  const keyRing = options?.keyRing ?? ring;

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
