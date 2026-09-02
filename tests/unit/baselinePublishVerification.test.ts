import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateAndVerifyBaselineArtifacts,
  publishBaselineParityArtifacts,
  BaselineParityPackage,
  BaselineAcceptanceReport,
} from '../../scripts/publish-baseline-artifacts';
import { canonicalizeJson, sha256Digest, canonicalJsonSha256 } from '../../scripts/lib/jcs';

describe('Baseline Publish and Acceptance Verification (establish-parity-baseline 5.1 & 5.2)', () => {
  const baseDir = process.cwd();
  it('generates valid baseline parity and acceptance report with all checks passing', () => {
    const result = publishBaselineParityArtifacts(baseDir, { writeArtifacts: true });
    const failedChecks = result.acceptanceReport.checks.filter(c => c.status === 'fail');
    if (failedChecks.length > 0) {
      expect.fail('Failed checks: ' + JSON.stringify(failedChecks, null, 2));
    }
    expect(result.baselineParity.schemaVersion).toBe('1');
    expect(result.baselineParity.artifactType).toBe('baseline-parity-package');
    expect(result.baselineParity.overallStatus).toBe('pass');
    expect(result.acceptanceReport.schemaVersion).toBe('1');
    expect(result.acceptanceReport.task).toBe('establish-parity-baseline-acceptance');
    expect(result.acceptanceReport.overallStatus).toBe('pass');
    expect(result.acceptanceReport.summary.failedChecks).toBe(0);
    expect(result.acceptanceReport.summary.passedChecks).toBeGreaterThanOrEqual(5);
    expect(result.acceptanceReport.summary.checksPassRatio).toBe(1.0);

    // All assertions returned are green
    expect(result.assertions.length).toBeGreaterThanOrEqual(5);
    expect(result.assertions.every((a) => a.passed)).toBe(true);
  });

  it('validates canonical JCS deterministic serialization for published artifacts', () => {
    const result = generateAndVerifyBaselineArtifacts(process.cwd());
    const canonicalBaseline = canonicalizeJson(result.baselineParity);
    const canonicalAcceptance = canonicalizeJson(result.acceptanceReport);

    expect(typeof canonicalBaseline).toBe('string');
    expect(typeof canonicalAcceptance).toBe('string');
    expect(canonicalBaseline.startsWith('{"artifactType":"baseline-parity-package",')).toBe(true);

    const digestBaseline = canonicalJsonSha256(result.baselineParity);
    const digestAcceptance = canonicalJsonSha256(result.acceptanceReport);
    expect(digestBaseline).toMatch(/^[0-9a-f]{64}$/);
    expect(digestAcceptance).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails check when LEGACY_CORPUS_SIGNED barrier is missing or invalid', () => {
    const fakeDir = path.join(process.cwd(), 'tests/fixtures/non-existent-dir');
    const result = generateAndVerifyBaselineArtifacts(fakeDir);

    expect(result.baselineParity.overallStatus).toBe('fail');
    expect(result.acceptanceReport.overallStatus).toBe('fail');
    const barrierCheck = result.acceptanceReport.checks.find((c) => c.id === 'CHK-BL-01-LEGACY-BARRIER');
    expect(barrierCheck).toBeDefined();
    expect(barrierCheck?.status).toBe('fail');
  });

  it('records digests for all discovered raw and normalized evidence artifacts', () => {
    const result = generateAndVerifyBaselineArtifacts(process.cwd());
    expect(result.baselineParity.evidenceDigests.length).toBeGreaterThan(0);
    for (const digestEntry of result.baselineParity.evidenceDigests) {
      expect(digestEntry.relativePath).toBeDefined();
      expect(digestEntry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
