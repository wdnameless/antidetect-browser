import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  performRemovalAcceptanceChecks,
  RemovalAcceptanceReport,
  RemovalAcceptanceCheckResult,
} from '../../scripts/verify-removal-acceptance';
import { verifyLegacyCorpusFile } from '../../scripts/verify-legacy-corpus';
describe('Camoufox Removal Acceptance Verification (Tasks 5.1 & 5.2)', () => {
  const baseDir = process.cwd();
  let reportResult: RemovalAcceptanceCheckResult;
  beforeAll(() => {
    reportResult = performRemovalAcceptanceChecks(baseDir);
  });

  describe('Pre-denial clone run & Legacy Corpus Barrier Verification', () => {
    it('verifies that LEGACY_CORPUS_SIGNED.json exists and has a valid Ed25519 signature', () => {
      const barrierPath = path.join(baseDir, 'evidence/barriers/LEGACY_CORPUS_SIGNED.json');
      expect(fs.existsSync(barrierPath)).toBe(true);

      const barrierJson = JSON.parse(fs.readFileSync(barrierPath, 'utf8'));
      expect(barrierJson.signature).toBeDefined();
      expect(barrierJson.publicKeyPem || barrierJson.publicKey).toBeDefined();
      expect(barrierJson.cloneExecutableSha256).toBeDefined();
      expect(barrierJson.cloneFilesystemInventorySha256).toBeDefined();
      expect(barrierJson.cloneDbSha256).toBeDefined();
      expect(barrierJson.fixtures.length).toBeGreaterThan(0);

      const verification = verifyLegacyCorpusFile(barrierPath);
      expect(verification.isValid).toBe(true);
      // Verify that clone hashes exist
      expect(barrierJson.cloneExecutableSha256).toBeDefined();
      expect(barrierJson.cloneFilesystemInventorySha256).toBeDefined();
      expect(barrierJson.cloneDbSha256).toBeDefined();

      // Check check in report
      const check = reportResult.report.checks.find((c) => c.id === 'CHK-01-LEGACY-BARRIER');
      const check3 = reportResult.report.checks.find((c) => c.id === 'CHK-03-EVIDENCE-PIPELINE');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });
  });
  describe('Preserved Browser Data & Inventory Verification', () => {
    it('verifies that camoufox-inventory.json exists and is valid', () => {
      const inventoryPath = path.join(baseDir, 'evidence/camoufox-inventory.json');
      expect(fs.existsSync(inventoryPath)).toBe(true);
      const invJson = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      expect(invJson.summary).toBeDefined();
      expect(Array.isArray(invJson.touchpoints) || Array.isArray(invJson.files)).toBe(true);
      const check = reportResult.report.checks.find((c) => c.id === 'CHK-02-DATA-PRESERVATION');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });
  });

  describe('Evidence Pipeline & Summary Verification', () => {
    it('verifies that all required normalized JCS summaries exist and pass', () => {
      const requiredNormalizedSummaries = [
        'evidence/normalized/legacy-corpus.summary.jcs.json',
        'evidence/normalized/camoufox-inventory.summary.jcs.json',
        'evidence/normalized/camoufox-denial.summary.jcs.json',
        'evidence/normalized/camoufox-export-cleanup.summary.jcs.json',
        'evidence/normalized/camoufox-removal-verification.summary.jcs.json',
        'evidence/normalized/camoufox-rollback-rehearsal.summary.jcs.json',
      ];

      for (const relPath of requiredNormalizedSummaries) {
        const fullPath = path.join(baseDir, relPath);
        expect(fs.existsSync(fullPath)).toBe(true);

        const summary = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        const isPass = (summary.success === true && summary.numFailedTests === 0) || (summary.totalTouchpoints !== undefined && summary.unclassifiedPaths === 0);
        expect(isPass).toBe(true);
      }

      const check = reportResult.report.checks.find((c) => c.id === 'CHK-03-EVIDENCE-PIPELINE');
      console.log('CHK-03 details:', JSON.stringify(check));
      expect(check).toBeDefined();
    });
  });

  describe('Package & Removal Hygiene Verification', () => {
    it('verifies that Camoufox is not present in package.json dependencies', () => {
      const pkgPath = path.join(baseDir, 'package.json');
      expect(fs.existsSync(pkgPath)).toBe(true);

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const allDeps = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));
      const hasCamoufox = allDeps.some((d) => d.toLowerCase().includes('camoufox'));
      expect(hasCamoufox).toBe(false);

      const check = reportResult.report.checks.find((c) => c.id === 'CHK-04-PACKAGE-HYGIENE');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });
  });

  describe('Overall Acceptance Report Verification', () => {
    it('produces a passing acceptance report with zero failures and zero unresolved items', () => {
      const { report, assertions } = reportResult;

      expect(report.schemaVersion).toBe('1');
      expect(report.change).toBe('remove-camoufox-engine');
      expect(report.overallStatus).toBe('pass');
      expect(report.summary.passed).toBe(report.summary.total);
      expect(report.summary.failed).toBe(0);
      expect(report.summary.unresolved).toBe(0);

      expect(assertions.length).toBe(report.summary.total);
      expect(assertions.every((a) => a.passed === true)).toBe(true);
    });
  });
});
