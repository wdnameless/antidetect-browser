import * as fs from 'fs';
import * as path from 'path';
import { canonicalizeJson } from './lib/jcs';
import { computeSha256 } from './lib/evidence-wrapper';
import { verifyLegacyCorpus, DOMAIN_SEPARATOR_LEGACY_CORPUS } from './lib/crypto-ed25519';

export interface EvidenceVerificationOptions {
  evidencePath?: string;
  keyPath?: string;
  publicKeyPem?: string;
  expectedKeyId?: string;
  maxAgeMs?: number;
  now?: number;
  allowQuarantined?: boolean;
  minParityThreshold?: number; // e.g. 1.0 for 100%
  expectedDigest?: string;
  checkDuplicateReports?: boolean;
  knownReportDigests?: string[];
  knownReportIds?: string[];
}

export interface VerificationCheckResult {
  code: string;
  name: string;
  passed: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface EvidenceVerificationReport {
  schemaVersion: '1';
  verifiedAt: string;
  targetEvidencePath: string;
  passed: boolean;
  statusCode: number; // 0 = success, 1 = failure
  failureReasons: string[];
  checks: VerificationCheckResult[];
  metadata?: Record<string, unknown>;
}

/**
 * Evidence Verifier Service
 * Validates integrity, freshness, signing key, quarantine status, digest,
 * parity metrics, and uniqueness of evidence artifacts.
 */
export class EvidenceVerifier {
  public static readonly DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  /**
   * Verify an evidence file against policies.
   */
  public verifyEvidence(options: EvidenceVerificationOptions): EvidenceVerificationReport {
    const now = options.now ?? Date.now();
    const evidencePath = options.evidencePath;
    const checks: VerificationCheckResult[] = [];
    const failureReasons: string[] = [];

    // 1. Availability / existence check
    if (!evidencePath || !fs.existsSync(evidencePath)) {
      const reason = `Evidence file unavailable or missing at path: ${evidencePath || '<undefined>'}`;
      failureReasons.push(reason);
      checks.push({
        code: 'ERR_EVIDENCE_UNAVAILABLE',
        name: 'Evidence File Availability',
        passed: false,
        error: reason,
        details: { evidencePath },
      });

      return {
        schemaVersion: '1',
        verifiedAt: new Date(now).toISOString(),
        targetEvidencePath: evidencePath || '',
        passed: false,
        statusCode: 1,
        failureReasons,
        checks,
      };
    }

    checks.push({
      code: 'CHK_EVIDENCE_AVAILABLE',
      name: 'Evidence File Availability',
      passed: true,
      details: { evidencePath },
    });

    // 2. Read and Parse JSON Content
    let rawContent = '';
    let parsed: Record<string, unknown> | null = null;
    try {
      rawContent = fs.readFileSync(evidencePath, 'utf8');
      parsed = JSON.parse(rawContent) as Record<string, unknown>;
    } catch (err: unknown) {
      const msg = `Failed to parse evidence JSON: ${err instanceof Error ? err.message : String(err)}`;
      failureReasons.push(msg);
      checks.push({
        code: 'ERR_EVIDENCE_MALFORMED',
        name: 'Evidence JSON Format',
        passed: false,
        error: msg,
      });

      return {
        schemaVersion: '1',
        verifiedAt: new Date(now).toISOString(),
        targetEvidencePath: evidencePath,
        passed: false,
        statusCode: 1,
        failureReasons,
        checks,
      };
    }

    checks.push({
      code: 'CHK_EVIDENCE_PARSE',
      name: 'Evidence JSON Format',
      passed: true,
    });

    // 3. Digest / Tamper Verification
    const computedDigest = computeSha256(rawContent);
    let digestMatches = true;
    let expectedDigest = options.expectedDigest;

    // If expectedDigest is provided, verify against rawContent SHA-256
    if (expectedDigest) {
      if (computedDigest.toLowerCase() !== expectedDigest.toLowerCase()) {
        digestMatches = false;
        const msg = `Payload digest mismatch: computed SHA-256 ${computedDigest} does not match expected ${expectedDigest}`;
        failureReasons.push(msg);
        checks.push({
          code: 'ERR_DIGEST_MISMATCH',
          name: 'Payload Digest Integrity',
          passed: false,
          error: msg,
          details: { computedDigest, expectedDigest },
        });
      }
    }

    // Also check if payload contains embedded contentAddress or digest
    if (parsed.contentAddress && typeof parsed.contentAddress === 'string') {
      const embeddedSha = parsed.contentAddress.replace(/^urn:sha256:/i, '');
      // When verifying self-embedded digest, check against canonicalized inner payload if signature is present
      if (parsed.signature && typeof parsed.signature === 'string') {
        const innerPayload = { ...parsed };
        delete innerPayload.signature;
        delete innerPayload.contentAddress;
        delete innerPayload.corpusSha256;
        // If corpusSha256 or similar
        const innerCanonicalSha = computeSha256(canonicalizeJson(innerPayload));
        if (embeddedSha.toLowerCase() !== innerCanonicalSha.toLowerCase() && embeddedSha.toLowerCase() !== computedDigest.toLowerCase()) {
          // If neither raw nor canonical matches
          const msg = `Embedded contentAddress SHA-256 (${embeddedSha}) does not match payload digest`;
          failureReasons.push(msg);
          checks.push({
            code: 'ERR_EMBEDDED_DIGEST_MISMATCH',
            name: 'Embedded Content Address Digest',
            passed: false,
            error: msg,
            details: { embeddedSha, innerCanonicalSha, computedDigest },
          });
          digestMatches = false;
        }
      }
    }

    if (digestMatches && expectedDigest) {
      checks.push({
        code: 'CHK_DIGEST_MATCH',
        name: 'Payload Digest Integrity',
        passed: true,
        details: { computedDigest, expectedDigest },
      });
    }

    // 4. Freshness / Timestamps Check
    const maxAgeMs = options.maxAgeMs ?? EvidenceVerifier.DEFAULT_MAX_AGE_MS;
    let recordTimestamp: number | null = null;

    if (typeof parsed.timestamp === 'string' || typeof parsed.timestamp === 'number') {
      recordTimestamp = new Date(parsed.timestamp).getTime();
    } else if (typeof parsed.generatedAt === 'string' || typeof parsed.generatedAt === 'number') {
      recordTimestamp = new Date(parsed.generatedAt).getTime();
    } else if (typeof parsed.createdAt === 'string' || typeof parsed.createdAt === 'number') {
      recordTimestamp = new Date(parsed.createdAt).getTime();
    } else if (typeof parsed.startTime === 'number') {
      recordTimestamp = parsed.startTime;
    }

    if (recordTimestamp !== null && !isNaN(recordTimestamp)) {
      const ageMs = now - recordTimestamp;
      if (ageMs > maxAgeMs) {
        const msg = `Stale evidence: record age is ${Math.round(ageMs / 1000)}s, exceeding max permitted age of ${Math.round(maxAgeMs / 1000)}s`;
        failureReasons.push(msg);
        checks.push({
          code: 'ERR_EVIDENCE_STALE',
          name: 'Evidence Freshness',
          passed: false,
          error: msg,
          details: { recordTimestamp, now, ageMs, maxAgeMs },
        });
      } else if (ageMs < -60000) {
        // Future timestamp by more than 1 minute
        const msg = `Invalid evidence timestamp: timestamp is in the future (${new Date(recordTimestamp).toISOString()})`;
        failureReasons.push(msg);
        checks.push({
          code: 'ERR_EVIDENCE_FUTURE_TIMESTAMP',
          name: 'Evidence Freshness',
          passed: false,
          error: msg,
          details: { recordTimestamp, now, ageMs },
        });
      } else {
        checks.push({
          code: 'CHK_EVIDENCE_FRESHNESS',
          name: 'Evidence Freshness',
          passed: true,
          details: { recordTimestamp, ageMs, maxAgeMs },
        });
      }
    } else {
      // Missing timestamp
      const msg = 'Evidence record missing timestamp, generatedAt, or createdAt';
      failureReasons.push(msg);
      checks.push({
        code: 'ERR_EVIDENCE_MISSING_TIMESTAMP',
        name: 'Evidence Freshness',
        passed: false,
        error: msg,
      });
    }

    // 5. Quarantine Check
    const isQuarantined =
      parsed.quarantined === true ||
      parsed.status === 'quarantined' ||
      parsed.quarantineStatus === 'active' ||
      (typeof parsed.environment === 'string' && parsed.environment.toLowerCase().includes('quarantine')) ||
      (Array.isArray(parsed.tags) && parsed.tags.includes('quarantined'));

    if (isQuarantined && !options.allowQuarantined) {
      const msg = 'Evidence is flagged as quarantined and cannot be accepted for baseline verification';
      failureReasons.push(msg);
      checks.push({
        code: 'ERR_EVIDENCE_QUARANTINED',
        name: 'Quarantine Status',
        passed: false,
        error: msg,
        details: { quarantined: true },
      });
    } else {
      checks.push({
        code: 'CHK_QUARANTINE_STATUS',
        name: 'Quarantine Status',
        passed: true,
        details: { quarantined: isQuarantined },
      });
    }

    // 6. Key ID & Signature Verification
    const hasSignature = typeof parsed.signature === 'string' && parsed.signature.length > 0;
    const keyId = typeof parsed.keyId === 'string' ? parsed.keyId : undefined;

    if (options.expectedKeyId) {
      if (!keyId || keyId !== options.expectedKeyId) {
        const msg = `Invalid or missing keyId: expected '${options.expectedKeyId}', received '${keyId || '<none>'}'`;
        failureReasons.push(msg);
        checks.push({
          code: 'ERR_INVALID_KEY_ID',
          name: 'Signing Key Identification',
          passed: false,
          error: msg,
          details: { expectedKeyId: options.expectedKeyId, actualKeyId: keyId },
        });
      } else {
        checks.push({
          code: 'CHK_KEY_ID',
          name: 'Signing Key Identification',
          passed: true,
          details: { keyId },
        });
      }
    }

    let publicKeyPem = options.publicKeyPem;
    if (!publicKeyPem && options.keyPath && fs.existsSync(options.keyPath)) {
      publicKeyPem = fs.readFileSync(options.keyPath, 'utf8');
    }

    if (publicKeyPem) {
      if (!hasSignature) {
        const msg = 'Unsigned evidence: public key provided but evidence has no signature';
        failureReasons.push(msg);
        checks.push({
          code: 'ERR_UNSIGNED_EVIDENCE',
          name: 'Cryptographic Signature',
          passed: false,
          error: msg,
        });
      } else {
        const payloadWithoutSig = { ...parsed };
        delete payloadWithoutSig.signature;
        const sigValid = verifyLegacyCorpus(
          payloadWithoutSig,
          parsed.signature as string,
          publicKeyPem
        );

        if (!sigValid) {
          const msg = 'Cryptographic signature verification failed';
          failureReasons.push(msg);
          checks.push({
            code: 'ERR_SIGNATURE_VERIFICATION_FAILED',
            name: 'Cryptographic Signature',
            passed: false,
            error: msg,
          });
        } else {
          checks.push({
            code: 'CHK_SIGNATURE_VALID',
            name: 'Cryptographic Signature',
            passed: true,
            details: { signatureLength: (parsed.signature as string).length },
          });
        }
      }
    }

    // 7. Threshold & Parity Metrics Check
    const minParityThreshold = options.minParityThreshold ?? 1.0; // Default 100%
    let parityRatio: number | null = null;

    if (parsed.success === false || parsed.status === 'fail' || parsed.status === 'failed') {
      parityRatio = 0.0;
    } else if (typeof parsed.parityRatio === 'number') {
      parityRatio = parsed.parityRatio;
    } else if (typeof parsed.parityScore === 'number') {
      parityRatio = parsed.parityScore > 1 ? parsed.parityScore / 100 : parsed.parityScore;
    } else if (
      typeof parsed.numPassedTests === 'number' &&
      typeof parsed.numTotalTests === 'number' &&
      parsed.numTotalTests > 0
    ) {
      parityRatio = parsed.numPassedTests / parsed.numTotalTests;
    } else if (
      typeof parsed.passedTestCount === 'number' &&
      typeof parsed.totalTestCount === 'number' &&
      parsed.totalTestCount > 0
    ) {
      parityRatio = parsed.passedTestCount / parsed.totalTestCount;
    } else if (parsed.success === true || parsed.status === 'pass' || parsed.status === 'passed') {
      parityRatio = 1.0;
    }
    if (parityRatio !== null) {
      if (parityRatio < minParityThreshold) {
        const msg = `Threshold failure: parity ratio ${(parityRatio * 100).toFixed(2)}% is below required minimum threshold ${(minParityThreshold * 100).toFixed(2)}%`;
        failureReasons.push(msg);
        checks.push({
          code: 'ERR_THRESHOLD_FAILED',
          name: 'Parity Metric Threshold',
          passed: false,
          error: msg,
          details: { parityRatio, minParityThreshold },
        });
      } else {
        checks.push({
          code: 'CHK_THRESHOLD_PASSED',
          name: 'Parity Metric Threshold',
          passed: true,
          details: { parityRatio, minParityThreshold },
        });
      }
    }

    // 8. Conflicting Duplicate Report Check
    const reportId = (parsed.id || parsed.reportId || parsed.runId) as string | undefined;
    if (options.checkDuplicateReports) {
      const knownDigests = options.knownReportDigests || [];
      const knownIds = options.knownReportIds || [];

      const isConflicting =
        (reportId && knownIds.includes(reportId) && !knownDigests.includes(computedDigest)) ||
        (knownDigests.includes(computedDigest) && reportId && knownIds.includes(reportId) === false);

      if (isConflicting) {
        const msg = `Conflicting duplicate report detected: report id '${reportId}' or digest conflicts with previously recorded runs`;
        failureReasons.push(msg);
        checks.push({
          code: 'ERR_CONFLICTING_DUPLICATE',
          name: 'Report Collision and Duplication',
          passed: false,
          error: msg,
          details: { reportId, computedDigest },
        });
      } else {
        checks.push({
          code: 'CHK_NO_CONFLICT',
          name: 'Report Collision and Duplication',
          passed: true,
        });
      }
    }

    const passed = failureReasons.length === 0;
    return {
      schemaVersion: '1',
      verifiedAt: new Date(now).toISOString(),
      targetEvidencePath: evidencePath,
      passed,
      statusCode: passed ? 0 : 1,
      failureReasons,
      checks,
      metadata: {
        rawSha256: computedDigest,
        recordTimestamp,
        reportId,
      },
    };
  }
}

/**
 * CLI runner for scripts/evidence-verifier.ts
 */
export async function runEvidenceVerifierCli(args: string[] = process.argv.slice(2)): Promise<number> {
  let evidencePath: string | undefined;
  let keyPath: string | undefined;
  let expectedKeyId: string | undefined;
  let maxAgeMs: number | undefined;
  let minParity: number | undefined;
  let expectedDigest: string | undefined;
  let jsonOutPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--evidence' && args[i + 1]) {
      evidencePath = args[++i];
    } else if (args[i] === '--key' && args[i + 1]) {
      keyPath = args[++i];
    } else if (args[i] === '--key-id' && args[i + 1]) {
      expectedKeyId = args[++i];
    } else if (args[i] === '--max-age-ms' && args[i + 1]) {
      maxAgeMs = parseInt(args[++i], 10);
    } else if (args[i] === '--min-parity' && args[i + 1]) {
      minParity = parseFloat(args[++i]);
    } else if (args[i] === '--digest' && args[i + 1]) {
      expectedDigest = args[++i];
    } else if (args[i] === '--json' && args[i + 1]) {
      jsonOutPath = args[++i];
    }
  }

  const verifier = new EvidenceVerifier();
  const report = verifier.verifyEvidence({
    evidencePath,
    keyPath,
    expectedKeyId,
    maxAgeMs,
    minParityThreshold: minParity,
    expectedDigest,
  });

  if (jsonOutPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOutPath)), { recursive: true });
    fs.writeFileSync(path.resolve(jsonOutPath), canonicalizeJson(report), 'utf8');
  }

  if (!report.passed) {
    console.error(`[EvidenceVerifier] FAIL: Evidence verification failed (${report.failureReasons.length} reasons):`);
    for (const reason of report.failureReasons) {
      console.error(`  - ${reason}`);
    }
    return 1;
  }

  console.log(`[EvidenceVerifier] PASS: Evidence verified successfully.`);
  return 0;
}

if (require.main === module) {
  runEvidenceVerifierCli().then((code) => {
    process.exit(code);
  });
}
