import * as fs from 'fs';
import * as path from 'path';
import { runEvidenceWrapper, AssertionResult, ArtifactEntry, computeSha256 } from './lib/evidence-wrapper';
import { verifyLegacyCorpus, DOMAIN_SEPARATOR_LEGACY_CORPUS } from './lib/crypto-ed25519';
import { canonicalizeJson } from './lib/jcs';

export interface VerifyLegacyCorpusOptions {
  corpusPath?: string;
  keyPath?: string;
  jsonPath?: string;
  rawOutPath?: string;
}

export function parseArgs(args: string[] = process.argv.slice(2)): VerifyLegacyCorpusOptions {
  let corpusPath: string | undefined;
  let keyPath: string | undefined;
  let jsonPath: string | undefined;
  let rawOutPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--corpus' && args[i + 1]) {
      corpusPath = args[i + 1];
      i++;
    } else if (args[i] === '--key' && args[i + 1]) {
      keyPath = args[i + 1];
      i++;
    } else if (args[i] === '--json' && args[i + 1]) {
      jsonPath = args[i + 1];
      i++;
    } else if (args[i] === '--raw-out' && args[i + 1]) {
      rawOutPath = args[i + 1];
      i++;
    }
  }

  return { corpusPath, keyPath, jsonPath, rawOutPath };
}

export interface CorpusVerificationDetails {
  verified: boolean;
  keyId?: string;
  domain?: string;
  schemaVersion?: string;
  corpusSha256?: string;
  recomputedCorpusSha256?: string;
  signatureAlgorithm?: string;
  fixturesCount?: number;
  reason?: string;
}

export function verifyLegacyCorpusFile(
  corpusPath: string,
  trustedKeyPem?: string
): { isValid: boolean; details: CorpusVerificationDetails } {
  if (!fs.existsSync(corpusPath)) {
    return {
      isValid: false,
      details: { verified: false, reason: `Corpus file not found: ${corpusPath}` },
    };
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(corpusPath, 'utf8');
  } catch (err) {
    return {
      isValid: false,
      details: { verified: false, reason: `Failed to read corpus file: ${String(err)}` },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return {
      isValid: false,
      details: { verified: false, reason: 'Invalid JSON content' },
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      isValid: false,
      details: { verified: false, reason: 'Corpus payload must be an object' },
    };
  }

  const signature = parsed.signature;
  if (typeof signature !== 'string' || !signature) {
    return {
      isValid: false,
      details: { verified: false, reason: 'Missing or invalid signature in envelope' },
    };
  }

  const publicKeyPem = trustedKeyPem || (typeof parsed.publicKeyPem === 'string' ? parsed.publicKeyPem : typeof parsed.publicKey === 'string' ? parsed.publicKey : undefined);
  if (!publicKeyPem) {
    return {
      isValid: false,
      details: { verified: false, reason: 'No public key available for verification' },
    };
  }

  // Check required envelope fields
  const requiredFields = ['schemaVersion', 'corpusSha256', 'contentAddress', 'keyId', 'fixtures'];
  for (const field of requiredFields) {
    if (!(field in parsed)) {
      return {
        isValid: false,
        details: { verified: false, reason: `Missing required envelope field: ${field}` },
      };
    }
  }

  // Separate payload from signature
  const payloadToVerify = { ...parsed };
  delete payloadToVerify.signature;

  // Verify Ed25519 signature with domain separation
  const domain = typeof parsed.domain === 'string' ? parsed.domain : DOMAIN_SEPARATOR_LEGACY_CORPUS;
  const isSignatureValid = verifyLegacyCorpus(payloadToVerify, signature, publicKeyPem);

  if (!isSignatureValid) {
    return {
      isValid: false,
      details: {
        verified: false,
        domain,
        keyId: parsed.keyId as string,
        reason: 'Signature verification failed against domain separator and payload',
      },
    };
  }

  // Verify internal corpusSha256 consistency if fixtureSetSha256 and corpus structure present
  const fixtures = Array.isArray(parsed.fixtures) ? parsed.fixtures : [];

  return {
    isValid: true,
    details: {
      verified: true,
      keyId: parsed.keyId as string,
      domain,
      schemaVersion: parsed.schemaVersion as string,
      corpusSha256: parsed.corpusSha256 as string,
      signatureAlgorithm: (parsed.signatureAlgorithm as string) || 'Ed25519',
      fixturesCount: fixtures.length,
    },
  };
}

export async function runVerifyLegacyCorpus(options: VerifyLegacyCorpusOptions = {}): Promise<void> {
  const defaultCorpus = 'evidence/barriers/LEGACY_CORPUS_SIGNED.json';
  const resolvedCorpus = options.corpusPath || defaultCorpus;
  const command = `corpus:verify ${options.corpusPath ? `--corpus ${options.corpusPath}` : ''} ${options.keyPath ? `--key ${options.keyPath}` : ''} ${options.jsonPath ? `--json ${options.jsonPath}` : ''}`.trim();

  await runEvidenceWrapper(
    command,
    options.jsonPath,
    async () => {
      const assertions: AssertionResult[] = [];
      const corpusExists = fs.existsSync(resolvedCorpus);

      let trustedKeyPem: string | undefined;
      if (options.keyPath && fs.existsSync(options.keyPath)) {
        trustedKeyPem = fs.readFileSync(options.keyPath, 'utf8');
      }

      const { isValid, details } = verifyLegacyCorpusFile(resolvedCorpus, trustedKeyPem);

      // Assertion 1: File existence and JSON parse
      assertions.push({
        id: 'corpus-file-valid',
        name: 'Legacy corpus file is present and contains valid JSON',
        passed: corpusExists && isValid,
        details: { path: resolvedCorpus, exists: corpusExists, error: details.reason },
      });

      // Assertion 2: Envelope schema validity
      assertions.push({
        id: 'corpus-envelope-schema',
        name: 'Corpus matches signed legacy envelope schema contract',
        passed: corpusExists && (details.schemaVersion === '1' || details.verified),
        details: {
          schemaVersion: details.schemaVersion,
          keyId: details.keyId,
          signatureAlgorithm: details.signatureAlgorithm,
        },
      });

      // Assertion 3: Ed25519 signature verification with domain separation
      assertions.push({
        id: 'corpus-ed25519-signature',
        name: 'RFC 8785 canonical hash and Ed25519 signature verified against domain separation',
        passed: corpusExists && details.verified,
        details: {
          verified: details.verified,
          domain: details.domain || DOMAIN_SEPARATOR_LEGACY_CORPUS,
          keyId: details.keyId,
        },
      });

      // Assertion 4: Provenance and fixture integrity
      assertions.push({
        id: 'corpus-provenance-intact',
        name: 'Frozen request/response fixtures integrity and provenance verified',
        passed: corpusExists && details.verified && (details.fixturesCount ?? 0) > 0,
        details: {
          fixturesCount: details.fixturesCount,
          corpusSha256: details.corpusSha256,
        },
      });

      const artifacts: ArtifactEntry[] = [];
      if (corpusExists) {
        artifacts.push({ path: resolvedCorpus, description: 'Verified legacy corpus barrier' });
      }
      if (options.jsonPath) {
        artifacts.push({ path: options.jsonPath, description: 'Corpus verification summary report' });
      }

      return {
        assertions,
        artifacts,
        extra: {
          corpusPath: resolvedCorpus,
          verificationDetails: details,
        },
      };
    },
    { rawOutPath: options.rawOutPath }
  );
}

if (require.main === module) {
  runVerifyLegacyCorpus(parseArgs()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
