import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { canonicalizeJson } from '../../scripts/lib/jcs';
import {
  generateEd25519KeyPair,
  signLegacyCorpus,
  verifyLegacyCorpus,
  DOMAIN_SEPARATOR_LEGACY_CORPUS,
} from '../../scripts/lib/crypto-ed25519';
import {
  buildEvidenceReport,
  createRawAndNormalizedEvidence,
  computeSha256,
  runEvidenceWrapper,
} from '../../scripts/lib/evidence-wrapper';

describe('RFC 8785 Canonical JSON (JCS)', () => {
  it('sorts keys lexicographically by UTF-16 code units', () => {
    const obj = { z: 1, a: 2, m: { y: 10, b: 20 } };
    const canonical = canonicalizeJson(obj);
    expect(canonical).toBe('{"a":2,"m":{"b":20,"y":10},"z":1}');
  });

  it('omits undefined values and ignores non-enumerable properties', () => {
    const obj = { a: 1, b: undefined, c: null };
    const canonical = canonicalizeJson(obj);
    expect(canonical).toBe('{"a":1,"c":null}');
  });

  it('serializes primitives and arrays correctly', () => {
    expect(canonicalizeJson('hello')).toBe('"hello"');
    expect(canonicalizeJson(123.45)).toBe('123.45');
    expect(canonicalizeJson(true)).toBe('true');
    expect(canonicalizeJson([3, 2, 1])).toBe('[3,2,1]');
  });

  it('handles complex nested objects deterministically', () => {
    const obj1 = { b: [{ y: 2, x: 1 }], a: { d: 4, c: 3 } };
    const obj2 = { a: { c: 3, d: 4 }, b: [{ x: 1, y: 2 }] };
    expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
  });
});

describe('Ed25519 Domain-Separated Signing and Verification', () => {
  it('signs and verifies payload with domain separation', () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const payload = { corpusId: 'legacy-v1', count: 42 };

    const signature = signLegacyCorpus(payload, privateKey);
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);

    const valid = verifyLegacyCorpus(payload, signature, publicKey);
    expect(valid).toBe(true);

    const invalid = verifyLegacyCorpus({ corpusId: 'tampered', count: 42 }, signature, publicKey);
    expect(invalid).toBe(false);
  });

  it('fails verification if domain separator is different or missing', () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const payload = { test: true };
    const signature = signLegacyCorpus(payload, privateKey);

    // Verifying with different key or tampered payload
    const otherKeys = generateEd25519KeyPair();
    expect(verifyLegacyCorpus(payload, signature, otherKeys.publicKey)).toBe(false);
  });
});

describe('Evidence Wrapper & Schema Verification', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('builds evidence report matching standard contract schema', () => {
    const startedAt = new Date().toISOString();
    const report = buildEvidenceReport({
      command: 'baseline:chromium',
      status: 'pass',
      assertions: [
        { id: 'a1', name: 'Assertion 1', passed: true },
        { id: 'a2', name: 'Assertion 2', passed: true },
      ],
      artifacts: [{ path: 'test.json', description: 'test artifact' }],
      startedAt,
    });

    expect(report.schemaVersion).toBe('1');
    expect(report.command).toBe('baseline:chromium');
    expect(report.status).toBe('pass');
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.unresolved).toBe(0);
    expect(report.assertions).toHaveLength(2);
    expect(report.artifacts).toHaveLength(1);
    expect(report.startedAt).toBe(startedAt);
    expect(typeof report.finishedAt).toBe('string');
  });

  it('marks report as fail if any assertion fails', () => {
    const report = buildEvidenceReport({
      command: 'check:webrtc',
      assertions: [
        { id: 'a1', name: 'Assertion 1', passed: true },
        { id: 'a2', name: 'Assertion 2', passed: false, message: 'leak detected' },
      ],
    });

    expect(report.status).toBe('fail');
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.unresolved).toBe(0);
  });

  it('creates raw and normalized evidence artifacts with SHA-256 digests', () => {
    const rawOutPath = path.join(tempDir, 'raw.json');
    const normalizedOutPath = path.join(tempDir, 'normalized.summary.jcs.json');

    const report = buildEvidenceReport({
      command: 'baseline:legacy-api',
      status: 'pass',
      assertions: [{ id: 'leg-1', name: 'API reachable', passed: true }],
    });

    const rawData = { testRunId: 'abc-123', rawDetails: [1, 2, 3] };

    const { rawSha256, summarySha256, normalized } = createRawAndNormalizedEvidence({
      rawOutPath,
      normalizedOutPath,
      report,
      rawData,
      overwriteRaw: false,
    });

    expect(fs.existsSync(rawOutPath)).toBe(true);
    expect(fs.existsSync(normalizedOutPath)).toBe(true);

    const savedRaw = fs.readFileSync(rawOutPath, 'utf8');
    const computedRawSha = computeSha256(savedRaw);
    expect(rawSha256).toBe(computedRawSha);
    expect(normalized.rawSha256).toBe(computedRawSha);
    expect(normalized.summarySha256).toBe(summarySha256);
  });

  it('prevents accidental overwrite of raw evidence when overwriteRaw is false', () => {
    const rawOutPath = path.join(tempDir, 'raw.json');
    const normalizedOutPath = path.join(tempDir, 'normalized.summary.jcs.json');

    fs.writeFileSync(rawOutPath, 'initial raw content');

    const report = buildEvidenceReport({
      command: 'baseline:legacy-api',
      status: 'pass',
    });

    expect(() =>
      createRawAndNormalizedEvidence({
        rawOutPath,
        normalizedOutPath,
        report,
        rawData: { new: 'data' },
        overwriteRaw: false,
      })
    ).toThrow(/Refusing to overwrite existing raw evidence/);
  });

  it('handles wrapper execution error gracefully setting status to fail', async () => {
    const origExitCode = process.exitCode;
    const report = await runEvidenceWrapper(
      'test:error-handling',
      undefined,
      async () => {
        throw new Error('Forced failure');
      }
    );

    expect(report.status).toBe('fail');
    expect(report.failed).toBe(1);
    expect(report.assertions[0].message).toContain('Forced failure');
    process.exitCode = origExitCode;
  });
});
