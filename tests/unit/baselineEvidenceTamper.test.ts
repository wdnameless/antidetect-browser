import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EvidenceVerifier, runEvidenceVerifierCli } from '../../scripts/evidence-verifier';
import { generateEd25519KeyPair, signLegacyCorpus } from '../../scripts/lib/crypto-ed25519';
import { computeSha256 } from '../../scripts/lib/evidence-wrapper';
import { canonicalizeJson } from '../../scripts/lib/jcs';

describe('Negative and Tampering Evidence Verification (establish-parity 4.3)', () => {
  let tempDir: string;
  let verifier: EvidenceVerifier;
  let validKeypair: { publicKeyPem: string; privateKeyPem: string };
  let alternateKeypair: { publicKeyPem: string; privateKeyPem: string };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-tamper-test-'));
    verifier = new EvidenceVerifier();
    validKeypair = generateEd25519KeyPair();
    alternateKeypair = generateEd25519KeyPair();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function createValidEvidencePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      schemaVersion: '1',
      id: 'report-parity-baseline-001',
      timestamp: new Date().toISOString(),
      parityScore: 100,
      parityRatio: 1.0,
      numTotalTests: 10,
      numPassedTests: 10,
      numFailedTests: 0,
      success: true,
      quarantined: false,
      keyId: 'ed25519-primary-key-2026',
      environment: 'production-parity',
      ...overrides,
    };
    return payload;
  }

  function signAndWritePayload(filePath: string, payload: Record<string, unknown>, privateKeyPem: string): string {
    const payloadCopy = { ...payload };
    delete payloadCopy.signature;
    const signature = signLegacyCorpus(payloadCopy, privateKeyPem);
    const signedPayload = {
      ...payloadCopy,
      signature,
    };
    const content = canonicalizeJson(signedPayload);
    fs.writeFileSync(filePath, content, 'utf8');
    return content;
  }

  describe('1. Unavailable Evidence Files', () => {
    it('reports failure when evidence file does not exist', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.json');
      const report = verifier.verifyEvidence({
        evidencePath: nonExistentPath,
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.failureReasons.length).toBeGreaterThan(0);
      expect(report.failureReasons[0]).toContain('unavailable or missing');

      const unavailableCheck = report.checks.find((c) => c.code === 'ERR_EVIDENCE_UNAVAILABLE');
      expect(unavailableCheck).toBeDefined();
      expect(unavailableCheck?.passed).toBe(false);
    });

    it('reports failure when evidence path is undefined or empty string', () => {
      const report = verifier.verifyEvidence({
        evidencePath: '',
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.checks.some((c) => c.code === 'ERR_EVIDENCE_UNAVAILABLE')).toBe(true);
    });
  });

  describe('2. Stale Evidence Timestamps and Outdated Run Records', () => {
    it('rejects evidence older than permitted maxAgeMs', () => {
      const evidenceFile = path.join(tempDir, 'stale-evidence.json');
      const now = Date.now();
      const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;

      const payload = createValidEvidencePayload({
        timestamp: new Date(tenDaysAgo).toISOString(),
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        now,
        maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days max
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.failureReasons.some((r) => r.includes('Stale evidence'))).toBe(true);

      const staleCheck = report.checks.find((c) => c.code === 'ERR_EVIDENCE_STALE');
      expect(staleCheck).toBeDefined();
      expect(staleCheck?.passed).toBe(false);
    });

    it('rejects evidence with future timestamp beyond allowable skew', () => {
      const evidenceFile = path.join(tempDir, 'future-evidence.json');
      const now = Date.now();
      const oneDayFuture = now + 24 * 60 * 60 * 1000;

      const payload = createValidEvidencePayload({
        timestamp: new Date(oneDayFuture).toISOString(),
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        now,
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.checks.some((c) => c.code === 'ERR_EVIDENCE_FUTURE_TIMESTAMP')).toBe(true);
    });

    it('rejects evidence missing all timestamp fields', () => {
      const evidenceFile = path.join(tempDir, 'no-timestamp.json');
      const payload = createValidEvidencePayload();
      delete payload.timestamp;
      delete payload.createdAt;
      delete payload.generatedAt;
      delete payload.startTime;

      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
      });

      expect(report.passed).toBe(false);
      expect(report.checks.some((c) => c.code === 'ERR_EVIDENCE_MISSING_TIMESTAMP')).toBe(true);
    });
  });

  describe('3. Quarantined Evidence', () => {
    it('rejects evidence flagged as quarantined: true', () => {
      const evidenceFile = path.join(tempDir, 'quarantined-flag.json');
      const payload = createValidEvidencePayload({
        quarantined: true,
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.failureReasons.some((r) => r.includes('quarantined'))).toBe(true);

      const qCheck = report.checks.find((c) => c.code === 'ERR_EVIDENCE_QUARANTINED');
      expect(qCheck).toBeDefined();
      expect(qCheck?.passed).toBe(false);
    });

    it('rejects evidence with quarantineStatus: active or status: quarantined', () => {
      const evidenceFile = path.join(tempDir, 'quarantine-status.json');
      const payload = createValidEvidencePayload({
        quarantineStatus: 'active',
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
      });

      expect(report.passed).toBe(false);
      expect(report.checks.some((c) => c.code === 'ERR_EVIDENCE_QUARANTINED')).toBe(true);
    });

    it('rejects evidence with quarantined tag', () => {
      const evidenceFile = path.join(tempDir, 'quarantine-tag.json');
      const payload = createValidEvidencePayload({
        tags: ['baseline', 'quarantined', 'legacy'],
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
      });

      expect(report.passed).toBe(false);
      expect(report.checks.some((c) => c.code === 'ERR_EVIDENCE_QUARANTINED')).toBe(true);
    });
  });

  describe('4. Unsigned or Invalid Key ID', () => {
    it('rejects unsigned evidence when signature verification is required with public key', () => {
      const evidenceFile = path.join(tempDir, 'unsigned-evidence.json');
      const payload = createValidEvidencePayload();
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        publicKeyPem: validKeypair.publicKeyPem,
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.checks.some((c) => c.code === 'ERR_UNSIGNED_EVIDENCE')).toBe(true);
    });

    it('rejects evidence with invalid keyId mismatch', () => {
      const evidenceFile = path.join(tempDir, 'wrong-keyid.json');
      const payload = createValidEvidencePayload({
        keyId: 'rogue-untrusted-key-id',
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        expectedKeyId: 'ed25519-primary-key-2026',
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.checks.some((c) => c.code === 'ERR_INVALID_KEY_ID')).toBe(true);
    });

    it('rejects evidence signed with wrong/mismatched private key', () => {
      const evidenceFile = path.join(tempDir, 'wrong-signature.json');
      const payload = createValidEvidencePayload();
      // Signed with alternateKeypair instead of validKeypair
      signAndWritePayload(evidenceFile, payload, alternateKeypair.privateKeyPem);

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        publicKeyPem: validKeypair.publicKeyPem,
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.checks.some((c) => c.code === 'ERR_SIGNATURE_VERIFICATION_FAILED')).toBe(true);
    });
  });

  describe('5. Tampered Payload / SHA-256 Digest Mismatch', () => {
    it('detects digest mismatch when raw content is altered after expected digest calculation', () => {
      const evidenceFile = path.join(tempDir, 'tampered-digest.json');
      const payload = createValidEvidencePayload({
        numPassedTests: 10,
      });
      const initialJson = JSON.stringify(payload);
      const originalDigest = computeSha256(initialJson);

      // Tamper: modify numPassedTests in payload on disk
      const tamperedPayload = { ...payload, numPassedTests: 9 };
      fs.writeFileSync(evidenceFile, JSON.stringify(tamperedPayload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        expectedDigest: originalDigest,
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.checks.some((c) => c.code === 'ERR_DIGEST_MISMATCH')).toBe(true);
    });

    it('detects tampered content in signed payload breaking cryptographic signature', () => {
      const evidenceFile = path.join(tempDir, 'tampered-signed.json');
      const payload = createValidEvidencePayload();
      signAndWritePayload(evidenceFile, payload, validKeypair.privateKeyPem);

      // Tamper with signed file by modifying property without resigning
      const fileData = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
      fileData.parityScore = 99;
      fs.writeFileSync(evidenceFile, JSON.stringify(fileData), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        publicKeyPem: validKeypair.publicKeyPem,
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.checks.some((c) => c.code === 'ERR_SIGNATURE_VERIFICATION_FAILED')).toBe(true);
    });
  });

  describe('6. Threshold-Failing Metrics (required 100%, got 90%)', () => {
    it('rejects evidence when parity ratio is below minimum required threshold', () => {
      const evidenceFile = path.join(tempDir, 'below-threshold.json');
      const payload = createValidEvidencePayload({
        parityRatio: 0.9,
        parityScore: 90,
        numPassedTests: 9,
        numTotalTests: 10,
        numFailedTests: 1,
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        minParityThreshold: 1.0, // Requires 100%
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.failureReasons.some((r) => r.includes('Threshold failure'))).toBe(true);

      const threshCheck = report.checks.find((c) => c.code === 'ERR_THRESHOLD_FAILED');
      expect(threshCheck).toBeDefined();
      expect(threshCheck?.passed).toBe(false);
    });

    it('rejects evidence when test run is marked success: false or failed status', () => {
      const evidenceFile = path.join(tempDir, 'failed-suite.json');
      const payload = createValidEvidencePayload({
        success: false,
        status: 'fail',
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        minParityThreshold: 1.0,
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.checks.some((c) => c.code === 'ERR_THRESHOLD_FAILED')).toBe(true);
    });
  });

  describe('7. Conflicting Duplicate Reports', () => {
    it('detects conflicting duplicate report with same ID but different payload digest', () => {
      const evidenceFile = path.join(tempDir, 'duplicate-report-b.json');
      const payload = createValidEvidencePayload({
        id: 'report-parity-baseline-001',
        dataChecksum: 'checksum-mutation-b',
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const report = verifier.verifyEvidence({
        evidencePath: evidenceFile,
        checkDuplicateReports: true,
        knownReportIds: ['report-parity-baseline-001'],
        knownReportDigests: ['known-hash-of-original-run-a'],
      });

      expect(report.passed).toBe(false);
      expect(report.statusCode).toBe(1);
      expect(report.checks.some((c) => c.code === 'ERR_CONFLICTING_DUPLICATE')).toBe(true);
    });
  });

  describe('8. CLI Runner non-zero exit simulation', () => {
    it('returns nonzero exit code (1) when running CLI against tampered/invalid evidence', async () => {
      const evidenceFile = path.join(tempDir, 'cli-tampered.json');
      const jsonOutPath = path.join(tempDir, 'cli-tampered-out.json');
      const payload = createValidEvidencePayload({
        quarantined: true,
      });
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const exitCode = await runEvidenceVerifierCli([
        '--evidence',
        evidenceFile,
        '--json',
        jsonOutPath,
      ]);

      expect(exitCode).toBe(1);
      expect(fs.existsSync(jsonOutPath)).toBe(true);

      const generatedReport = JSON.parse(fs.readFileSync(jsonOutPath, 'utf8'));
      expect(generatedReport.passed).toBe(false);
      expect(generatedReport.statusCode).toBe(1);
    });

    it('returns exit code (0) and writes report when evidence is valid and untampered', async () => {
      const evidenceFile = path.join(tempDir, 'cli-valid.json');
      const jsonOutPath = path.join(tempDir, 'cli-valid-out.json');
      const payload = createValidEvidencePayload();
      fs.writeFileSync(evidenceFile, JSON.stringify(payload), 'utf8');

      const exitCode = await runEvidenceVerifierCli([
        '--evidence',
        evidenceFile,
        '--json',
        jsonOutPath,
      ]);

      expect(exitCode).toBe(0);
      expect(fs.existsSync(jsonOutPath)).toBe(true);

      const generatedReport = JSON.parse(fs.readFileSync(jsonOutPath, 'utf8'));
      expect(generatedReport.passed).toBe(true);
      expect(generatedReport.statusCode).toBe(0);
    });
  });
});
