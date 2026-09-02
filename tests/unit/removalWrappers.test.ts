import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCamoufoxAudit } from '../../scripts/camoufox-audit';
import { runCorpusVerifier } from '../../scripts/corpus-verifier';
import { runContractReplay } from '../../scripts/contract-replay';
import { runCheckDocsClaims } from '../../scripts/check-docs-claims';
import { runCheckPackageHygiene } from '../../scripts/check-package-hygiene';
import { runCamoufoxE2ECheck } from '../../scripts/camoufox-e2e-check';
import {
  buildEvidenceReport,
  createRawAndNormalizedEvidence,
  computeSha256,
  runEvidenceWrapper,
  EvidenceRecord,
  NormalizedSummaryRecord,
} from '../../scripts/lib/evidence-wrapper';
import {
  generateEd25519KeyPair,
  signLegacyCorpus,
  DOMAIN_SEPARATOR_LEGACY_CORPUS,
} from '../../scripts/lib/crypto-ed25519';

describe('Remove-Camoufox Acceptance Wrappers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'removal-wrappers-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('runs camoufox-audit and emits conforming evidence schema', async () => {
    const jsonPath = path.join(tempDir, 'camoufox-audit.summary.jcs.json');
    const rawOutPath = path.join(tempDir, 'camoufox-audit.raw.json');

    await runCamoufoxAudit({ jsonPath, rawOutPath, strict: true });

    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(rawOutPath)).toBe(true);

    const report: NormalizedSummaryRecord = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(report.schemaVersion).toBe('1');
    expect(report.command).toContain('check:camoufox-audit');
    expect(report.status).toBe('pass');
    expect(report.passed).toBeGreaterThan(0);
    expect(report.failed).toBe(0);
    expect(report.unresolved).toBe(0);
    expect(report.assertions.length).toBeGreaterThan(0);
    expect(report.rawSha256).toBe(computeSha256(rawOutPath));
    expect(typeof report.summarySha256).toBe('string');
  });

  it('runs corpus-verifier with signed legacy corpus fixture', async () => {
    const jsonPath = path.join(tempDir, 'corpus-verify.summary.jcs.json');
    const rawOutPath = path.join(tempDir, 'corpus-verify.raw.json');
    const corpusPath = path.join(tempDir, 'test-corpus.json');
    const keyPath = path.join(tempDir, 'test-key.pub');

    const { publicKey, privateKey } = generateEd25519KeyPair();
    fs.writeFileSync(keyPath, publicKey);

    const payload = {
      schemaVersion: '1',
      envelope: 'LEGACY_CORPUS_SIGNED',
      fixtures: [
        { path: '/api/v1/profiles', method: 'GET', status: 200 },
        { path: '/api/v1/profile/create', method: 'POST', body: { browser: 'camoufox' }, status: 400 },
      ],
    };

    const payloadWithoutSignature = {
      ...payload,
      publicKey,
    };
    const signature = signLegacyCorpus(payloadWithoutSignature, privateKey);
    const corpusFileContent = {
      ...payloadWithoutSignature,
      signature,
    };
    fs.writeFileSync(corpusPath, JSON.stringify(corpusFileContent, null, 2));

    await runCorpusVerifier({ corpusPath, keyPath, jsonPath, rawOutPath });

    expect(fs.existsSync(jsonPath)).toBe(true);
    const report: NormalizedSummaryRecord = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(report.schemaVersion).toBe('1');
    expect(report.status).toBe('pass');
    expect(report.passed).toBeGreaterThan(0);
    expect(report.failed).toBe(0);
  });

  it('runs contract-replay and outputs valid report schema', async () => {
    const jsonPath = path.join(tempDir, 'contract-replay.summary.jcs.json');
    const rawOutPath = path.join(tempDir, 'contract-replay.raw.json');

    await runContractReplay({ jsonPath, rawOutPath, targetUrl: 'http://localhost:3000' });

    expect(fs.existsSync(jsonPath)).toBe(true);
    const report: NormalizedSummaryRecord = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(report.schemaVersion).toBe('1');
    expect(report.command).toContain('contract:replay');
    expect(report.status).toBe('pass');
    expect(report.passed).toBeGreaterThan(0);
    expect(report.failed).toBe(0);
  });

  it('runs check-docs-claims and audits documentation for invalid claims', async () => {
    const jsonPath = path.join(tempDir, 'docs-claims.summary.jcs.json');
    const rawOutPath = path.join(tempDir, 'docs-claims.raw.json');

    await runCheckDocsClaims({ jsonPath, rawOutPath, strict: true });

    expect(fs.existsSync(jsonPath)).toBe(true);
    const report: NormalizedSummaryRecord = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(report.schemaVersion).toBe('1');
    expect(report.command).toContain('check:docs-claims');
    expect(report.status).toBe('pass');
  });

  it('runs check-package-hygiene and checks dependency/build constraints', async () => {
    const jsonPath = path.join(tempDir, 'pkg-hygiene.summary.jcs.json');
    const rawOutPath = path.join(tempDir, 'pkg-hygiene.raw.json');

    await runCheckPackageHygiene({ jsonPath, rawOutPath, strict: true });

    expect(fs.existsSync(jsonPath)).toBe(true);
    const report: NormalizedSummaryRecord = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(report.schemaVersion).toBe('1');
    expect(report.command).toContain('check:package-hygiene');
    expect(report.status).toBe('pass');
  });

  it('runs camoufox-e2e-check and checks refusal & containment assertions', async () => {
    const jsonPath = path.join(tempDir, 'camoufox-e2e.summary.jcs.json');
    const rawOutPath = path.join(tempDir, 'camoufox-e2e.raw.json');

    await runCamoufoxE2ECheck({ jsonPath, rawOutPath, headless: true });

    expect(fs.existsSync(jsonPath)).toBe(true);
    const report: NormalizedSummaryRecord = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(report.schemaVersion).toBe('1');
    expect(report.command).toContain('check:camoufox-e2e');
    expect(report.status).toBe('pass');
    expect(report.passed).toBeGreaterThan(0);
  });

  it('enforces non-overwriting of raw evidence files', () => {
    const rawOutPath = path.join(tempDir, 'immutable.raw.json');
    const normalizedOutPath = path.join(tempDir, 'immutable.summary.jcs.json');

    fs.writeFileSync(rawOutPath, 'already existing raw evidence');

    const report = buildEvidenceReport({
      command: 'check:camoufox-audit',
      status: 'pass',
      assertions: [{ id: 'a1', name: 'Test', passed: true }],
    });

    expect(() => {
      createRawAndNormalizedEvidence({
        rawOutPath,
        normalizedOutPath,
        report,
        rawData: { data: 123 },
        overwriteRaw: false,
      });
    }).toThrow(/Refusing to overwrite existing raw evidence/);
  });

  it('generates nonzero exit codes / failure statuses on failed assertions', async () => {
    const jsonPath = path.join(tempDir, 'failure-test.summary.jcs.json');

    const report = await runEvidenceWrapper(
      'check:simulated-failure',
      jsonPath,
      async () => {
        return {
          assertions: [
            { id: 'f1', name: 'Must pass', passed: true },
            { id: 'f2', name: 'Forced failure', passed: false, message: 'Simulated failure' },
          ],
        };
      },
      { exitOnFailure: false }
    );

    expect(report.status).toBe('fail');
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.unresolved).toBe(0);
  });

  it('generates unresolved status on missing test requirements', async () => {
    const jsonPath = path.join(tempDir, 'unresolved-test.summary.jcs.json');

    const report = await runEvidenceWrapper(
      'check:simulated-unresolved',
      jsonPath,
      async () => {
        return {
          assertions: [{ id: 'u1', name: 'Pending test', passed: true }],
          statusOverride: 'unresolved',
        };
      },
      { exitOnFailure: false }
    );

    expect(report.status).toBe('unresolved');
  });
});
