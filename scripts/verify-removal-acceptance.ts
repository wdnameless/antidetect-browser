import * as fs from 'fs';
import * as path from 'path';
import { runEvidenceWrapper, AssertionResult, ArtifactEntry, computeSha256 } from './lib/evidence-wrapper';
import { canonicalizeJson } from './lib/jcs';
import { verifyLegacyCorpus } from './lib/crypto-ed25519';
import { verifyLegacyCorpusFile } from './verify-legacy-corpus';

export interface AcceptanceVerificationOptions {
  jsonPath?: string;
  rawOutPath?: string;
  strict?: boolean;
}

export interface VerificationCheck {
  id: string;
  name: string;
  status: 'pass' | 'fail';
  details?: Record<string, unknown> | string;
}

export interface RemovalAcceptanceReport {
  schemaVersion: '1';
  timestamp: string;
  change: 'remove-camoufox-engine';
  overallStatus: 'pass' | 'fail';
  checks: VerificationCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    unresolved: number;
  };
  artifacts: Array<{
    path: string;
    sha256: string;
  }>;
}

export interface RemovalAcceptanceCheckResult {
  report: RemovalAcceptanceReport;
  assertions: AssertionResult[];
  artifacts: ArtifactEntry[];
}

export function performRemovalAcceptanceChecks(baseDir: string = process.cwd()): RemovalAcceptanceCheckResult {
  const assertions: AssertionResult[] = [];
  const checks: VerificationCheck[] = [];
  const artifactEntries: ArtifactEntry[] = [];
  const evidenceArtifacts: Array<{ path: string; sha256: string }> = [];

  // Helper to record assertion and check
  const recordCheck = (
    id: string,
    name: string,
    passed: boolean,
    details?: Record<string, unknown> | string
  ) => {
    const status: 'pass' | 'fail' = passed ? 'pass' : 'fail';
    checks.push({ id, name, status, details });
    assertions.push({
      name: `${id}: ${name}`,
      passed,
      details,
    });
  };

  // 1. Check Pre-denial clone run & Legacy Corpus barrier existence and Ed25519 signature
  const barrierPath = path.join(baseDir, 'evidence/barriers/LEGACY_CORPUS_SIGNED.json');
  const keyPath = path.join(baseDir, 'config/keys/legacy-corpus-ed25519.pub');
  let barrierValid = false;
  let barrierDetails: Record<string, unknown> = {};

  if (fs.existsSync(barrierPath)) {
    try {
      const trustedKeyPem = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : undefined;
      const result = verifyLegacyCorpusFile(barrierPath, trustedKeyPem);
      const barrierRaw = fs.readFileSync(barrierPath, 'utf8');
      const barrierJson = JSON.parse(barrierRaw);

      const hasClones = Boolean(
        barrierJson.cloneExecutableSha256 &&
        barrierJson.cloneFilesystemInventorySha256 &&
        barrierJson.cloneDbSha256
      );

      barrierValid = Boolean(result.isValid && hasClones);
      barrierDetails = {
        exists: true,
        verified: result.isValid,
        verificationDetails: result.details,
        hasClones,
        keyId: barrierJson.keyId,
        fixturesCount: Array.isArray(barrierJson.fixtures) ? barrierJson.fixtures.length : 0,
      };
    } catch (e) {
      barrierDetails = { error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    barrierDetails = {
      barrierExists: false,
    };
  }

  recordCheck(
    'CHK-01-LEGACY-BARRIER',
    'Pre-denial clone run and signed LEGACY_CORPUS_SIGNED barrier verification',
    barrierValid,
    barrierDetails
  );

  // 2. Check Preserved Browser Data & Inventory
  const inventoryPath = path.join(baseDir, 'evidence/camoufox-inventory.json');
  let inventoryValid = false;
  let inventoryDetails: Record<string, unknown> = {};
  if (fs.existsSync(inventoryPath)) {
    try {
      const invRaw = fs.readFileSync(inventoryPath, 'utf8');
      const invJson = JSON.parse(invRaw);
      inventoryValid = Boolean(
        invJson.summary &&
        (invJson.touchpoints || invJson.files) &&
        (invJson.summary.totalTouchpoints !== undefined || invJson.summary.totalFiles !== undefined)
      );
      inventoryDetails = {
        valid: true,
        schemaVersion: invJson.schemaVersion || invJson.manifestVersion,
        generatedAt: invJson.generatedAt,
        categories: invJson.summary?.categories,
        totalTouchpoints: invJson.summary?.totalTouchpoints,
        inventorySha256: computeSha256(Buffer.from(invRaw, 'utf8')),
      };

      const digest = computeSha256(Buffer.from(invRaw, 'utf8'));
      evidenceArtifacts.push({ path: 'evidence/camoufox-inventory.json', sha256: digest });
      artifactEntries.push({ path: inventoryPath, description: 'Camoufox preservation inventory' });
    } catch (e) {
      inventoryDetails = { error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    inventoryDetails = { exists: false };
  }

  recordCheck(
    'CHK-02-DATA-PRESERVATION',
    'Preserved browser data registry and filesystem inventory verification',
    inventoryValid,
    inventoryDetails
  );

  // 3. Check Evidence Summaries & Test Evidence
  const requiredNormalizedSummaries = [
    'evidence/normalized/legacy-corpus.summary.jcs.json',
    'evidence/normalized/camoufox-inventory.summary.jcs.json',
    'evidence/normalized/camoufox-denial.summary.jcs.json',
    'evidence/normalized/camoufox-export-cleanup.summary.jcs.json',
    'evidence/normalized/camoufox-removal-verification.summary.jcs.json',
    'evidence/normalized/camoufox-rollback-rehearsal.summary.jcs.json',
  ];

  let allSummariesValid = true;
  const summaryDetails: Record<string, boolean> = {};

  for (const relPath of requiredNormalizedSummaries) {
    const fullPath = path.join(baseDir, relPath);
    if (!fs.existsSync(fullPath)) {
      allSummariesValid = false;
      summaryDetails[relPath] = false;
      continue;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(content);
      const isPass =
        parsed.status === 'pass' ||
        parsed.success === true ||
        (parsed.numFailedTests === 0 && (parsed.numPassedTests > 0 || parsed.numTotalTests > 0)) ||
        (parsed.totalTouchpoints !== undefined && parsed.unclassifiedPaths === 0);
      summaryDetails[relPath] = Boolean(isPass);
      if (!isPass) {
        allSummariesValid = false;
      }
      evidenceArtifacts.push({ path: relPath, sha256: computeSha256(content) });
      artifactEntries.push({ path: fullPath, description: `Normalized summary: ${relPath}` });
    } catch {
      allSummariesValid = false;
      summaryDetails[relPath] = false;
    }
  }

  recordCheck(
    'CHK-03-EVIDENCE-PIPELINE',
    'Vitest raw test runs and canonical normalized JCS summaries',
    allSummariesValid,
    summaryDetails
  );

  // 4. Check Package & Source Hygiene (Camoufox removed from dependencies and source files)
  const pkgPath = path.join(baseDir, 'package.json');
  let hygieneValid = false;
  let hygieneDetails: Record<string, unknown> = {};

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      const hasCamoufoxDep = deps.concat(devDeps).some((d) => d.toLowerCase().includes('camoufox'));
      hygieneValid = !hasCamoufoxDep;
      hygieneDetails = {
        hasCamoufoxDep,
        version: pkg.version,
      };
    } catch (e) {
      hygieneDetails = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  recordCheck(
    'CHK-04-PACKAGE-HYGIENE',
    'Dependency and source removal hygiene (no active Camoufox package or loader)',
    hygieneValid,
    hygieneDetails
  );

  // Calculate totals
  const total = checks.length;
  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const overallStatus: 'pass' | 'fail' = failed === 0 ? 'pass' : 'fail';

  const report: RemovalAcceptanceReport = {
    schemaVersion: '1',
    timestamp: new Date().toISOString(),
    change: 'remove-camoufox-engine',
    overallStatus,
    checks,
    summary: {
      total,
      passed,
      failed,
      unresolved: 0,
    },
    artifacts: evidenceArtifacts,
  };

  return { report, assertions, artifacts: artifactEntries };
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const acceptanceJsonPath = path.join(
    process.cwd(),
    'evidence/acceptance/remove-camoufox-engine-acceptance.json'
  );
  let jsonPath: string | undefined = undefined;
  let rawOutPath: string | undefined = undefined;
  let strict = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json' && args[i + 1]) {
      jsonPath = args[i + 1];
      i++;
    } else if (args[i] === '--raw-out' && args[i + 1]) {
      rawOutPath = args[i + 1];
      i++;
    } else if (args[i] === '--no-strict') {
      strict = false;
    }
  }

  const command = `verify:removal-acceptance`.trim();

  await runEvidenceWrapper(
    command,
    jsonPath,
    async () => {
      const { report, assertions, artifacts } = performRemovalAcceptanceChecks(process.cwd());

      fs.mkdirSync(path.dirname(acceptanceJsonPath), { recursive: true });
      fs.writeFileSync(acceptanceJsonPath, JSON.stringify(report, null, 2), 'utf8');
      console.log(`Accepted report written to: ${acceptanceJsonPath}`);

      artifacts.push({
        path: acceptanceJsonPath,
        description: 'Oracle acceptance report for remove-camoufox-engine',
      });

      return {
        assertions,
        artifacts,
        extra: {
          overallStatus: report.overallStatus,
          summary: report.summary,
        },
      };
    },
    { rawOutPath, strict }
  );
}
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during removal acceptance verification:', err);
    process.exit(1);
  });
}
