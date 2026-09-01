import * as fs from 'fs';
import * as path from 'path';
import { canonicalizeJson } from './lib/jcs';
import {
  generateEd25519KeyPair,
  signLegacyCorpus,
  DOMAIN_SEPARATOR_LEGACY_CORPUS,
} from './lib/crypto-ed25519';
import { computeSha256 } from './lib/evidence-wrapper';
import { createIsolatedClone, CloneManifest } from './lib/isolated-clone';

export const DEFAULT_CORPUS_OUT_PATH = path.resolve(process.cwd(), 'evidence/barriers/LEGACY_CORPUS_SIGNED.json');
export interface LegacyFixtureEntry {
  id: string;
  name: string;
  apiVersion: 'v1' | 'v2';
  category: 'create' | 'import' | 'duplicate' | 'start' | 'stop' | 'bulk' | 'script' | 'sync';
  request: {
    method: 'GET' | 'POST' | 'DELETE' | 'PUT';
    path: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
  sideEffects?: {
    profileCreated?: boolean;
    profileDeleted?: boolean;
    groupCreated?: boolean;
    stateMutated?: boolean;
  };
  precedence?: string;
  mixedBulkSemantics?: {
    total?: number;
    succeeded?: number;
    failed?: number;
    errors?: Array<{ id?: string; error: string; code?: number }>;
  };
}

export interface LegacyCorpusPayload {
  schemaVersion: string;
  corpusSha256: string;
  contentAddress: string;
  createdAt: string;
  sourceBuildSha256: string;
  cloneExecutableSha256: string;
  cloneDbSha256: string;
  cloneFilesystemInventorySha256: string;
  apiVersions: string[];
  fixtureSetSha256: string;
  keyId: string;
  publicKeyPem: string;
  signatureAlgorithm: 'Ed25519';
  domain: string;
  fixtures: LegacyFixtureEntry[];
}

export interface SignedLegacyCorpusEnvelope extends LegacyCorpusPayload {
  signature: string;
}

export function generateLegacyFixtures(): LegacyFixtureEntry[] {
  const fixtures: LegacyFixtureEntry[] = [
    // 1. Create Profile - Chromium (Success)
    {
      id: 'v1-profile-create-chromium-success',
      name: 'V1 Create Profile with Chromium engine (success)',
      apiVersion: 'v1',
      category: 'create',
      request: {
        method: 'POST',
        path: '/api/v1/browser-profile/create',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-create-chrom-001',
          'user-agent': 'Antidetect-Client/1.0',
        },
        body: {
          name: 'Legacy Test Chromium Profile',
          browser_type: 'chromium',
          timezone: 'America/New_York',
          user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          start_urls: ['https://example.com'],
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-create-chrom-001',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {
            user_id: 'prof-legacy-chrom-001',
          },
        },
      },
      sideEffects: {
        profileCreated: true,
        stateMutated: true,
      },
    },

    // 2. Create Profile - Legacy Firefox/Camoufox (Legacy refusal / validation error)
    {
      id: 'v1-profile-create-firefox-refusal',
      name: 'V1 Create Profile with Firefox engine (refusal/deprecated response)',
      apiVersion: 'v1',
      category: 'create',
      request: {
        method: 'POST',
        path: '/api/v1/browser-profile/create',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-create-ff-002',
          'user-agent': 'Antidetect-Client/1.0',
        },
        body: {
          name: 'Legacy Firefox Profile',
          browser_type: 'firefox',
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-create-ff-002',
        },
        body: {
          code: -1,
          msg: 'firefox browser type is deprecated and retired; only chromium is supported',
          data: {},
        },
      },
      sideEffects: {
        profileCreated: false,
        stateMutated: false,
      },
      precedence: 'validation-over-creation',
    },

    // 3. Duplicate Profile (Success)
    {
      id: 'v1-profile-duplicate-success',
      name: 'V1 Duplicate Profile (success)',
      apiVersion: 'v1',
      category: 'duplicate',
      request: {
        method: 'POST',
        path: '/api/v1/browser-profile/duplicate',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-dup-001',
        },
        body: {
          user_id: 'prof-legacy-chrom-001',
          name: 'Legacy Duplicated Profile',
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-dup-001',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {
            user_id: 'prof-legacy-chrom-001-dup',
          },
        },
      },
      sideEffects: {
        profileCreated: true,
        stateMutated: true,
      },
    },

    // 4. Duplicate Profile - Missing Source (Failure)
    {
      id: 'v1-profile-duplicate-not-found',
      name: 'V1 Duplicate Profile - Source not found',
      apiVersion: 'v1',
      category: 'duplicate',
      request: {
        method: 'POST',
        path: '/api/v1/browser-profile/duplicate',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-dup-002',
        },
        body: {
          user_id: 'non-existent-profile-id',
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-dup-002',
        },
        body: {
          code: -1,
          msg: 'source profile not found',
          data: {},
        },
      },
      sideEffects: {
        profileCreated: false,
        stateMutated: false,
      },
    },

    // 5. Start Browser Profile (Success)
    {
      id: 'v1-browser-start-success',
      name: 'V1 Start Browser Profile (success)',
      apiVersion: 'v1',
      category: 'start',
      request: {
        method: 'GET',
        path: '/api/v1/browser/start?user_id=prof-legacy-chrom-001',
        headers: {
          'accept': 'application/json',
          'x-request-id': 'req-start-001',
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-start-001',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {
            ws: {
              puppeteer: 'ws://127.0.0.1:9222/devtools/browser/legacy-session-001',
              selenium: '127.0.0.1:9222',
            },
            port: 9222,
            profile_id: 'prof-legacy-chrom-001',
          },
        },
      },
      sideEffects: {
        stateMutated: true,
      },
    },

    // 6. Start Browser Profile - Firefox Denial
    {
      id: 'v1-browser-start-firefox-denied',
      name: 'V1 Start Browser Profile - Legacy Firefox Refusal',
      apiVersion: 'v1',
      category: 'start',
      request: {
        method: 'GET',
        path: '/api/v1/browser/start?user_id=prof-legacy-firefox-001',
        headers: {
          'accept': 'application/json',
          'x-request-id': 'req-start-002',
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-start-002',
        },
        body: {
          code: -1,
          msg: 'firefox profiles are retired and cannot be launched',
          data: {},
        },
      },
      sideEffects: {
        stateMutated: false,
      },
      precedence: 'engine-check-before-process-launch',
    },

    // 7. Stop Browser Profile (Success)
    {
      id: 'v1-browser-stop-success',
      name: 'V1 Stop Browser Profile (success)',
      apiVersion: 'v1',
      category: 'stop',
      request: {
        method: 'GET',
        path: '/api/v1/browser/stop?user_id=prof-legacy-chrom-001',
        headers: {
          'accept': 'application/json',
          'x-request-id': 'req-stop-001',
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-stop-001',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {},
        },
      },
      sideEffects: {
        stateMutated: true,
      },
    },

    // 8. Import Profiles - JSON Array (Success)
    {
      id: 'v1-profile-import-json-success',
      name: 'V1 Import Profiles with JSON payload (success)',
      apiVersion: 'v1',
      category: 'import',
      request: {
        method: 'POST',
        path: '/api/v1/browser-profile/import',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-import-001',
        },
        body: {
          profiles: [
            { name: 'Imported Profile 1', browser_type: 'chromium' },
            { name: 'Imported Profile 2', browser_type: 'chromium' },
          ],
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-import-001',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {
            total: 2,
            succeeded: 2,
            failed: 0,
            ids: ['prof-imported-001', 'prof-imported-002'],
            errors: [],
          },
        },
      },
      sideEffects: {
        profileCreated: true,
        stateMutated: true,
      },
    },

    // 9. Import Profiles - CSV Text (Success)
    {
      id: 'v1-profile-import-csv-success',
      name: 'V1 Import Profiles with CSV payload (success)',
      apiVersion: 'v1',
      category: 'import',
      request: {
        method: 'POST',
        path: '/api/v1/browser-profile/import',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-import-002',
        },
        body: {
          csv: 'name,browser_type,proxy\nCSV Profile 1,chromium,http://127.0.0.1:8080\nCSV Profile 2,chromium,http://127.0.0.1:8081',
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-import-002',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {
            total: 2,
            succeeded: 2,
            failed: 0,
            ids: ['prof-csv-001', 'prof-csv-002'],
            errors: [],
          },
        },
      },
      sideEffects: {
        profileCreated: true,
        stateMutated: true,
      },
    },

    // 10. Bulk Batch Delete / Operation - Mixed Semantics (Partial Success / Failure)
    {
      id: 'v1-bulk-batch-delete-mixed',
      name: 'V1 Bulk Batch Operation with Mixed Success and Failure',
      apiVersion: 'v1',
      category: 'bulk',
      request: {
        method: 'POST',
        path: '/api/v1/browser-profile/batch-delete',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-bulk-001',
        },
        body: {
          user_ids: ['prof-legacy-chrom-001', 'non-existent-profile-999', 'prof-legacy-chrom-001-dup'],
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-bulk-001',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {
            total: 3,
            succeeded: 2,
            failed: 1,
            errors: [
              { user_id: 'non-existent-profile-999', error: 'profile not found', code: -1 },
            ],
          },
        },
      },
      mixedBulkSemantics: {
        total: 3,
        succeeded: 2,
        failed: 1,
        errors: [{ id: 'non-existent-profile-999', error: 'profile not found', code: -1 }],
      },
      sideEffects: {
        profileDeleted: true,
        stateMutated: true,
      },
    },

    // 11. Script Execution - Create and Run
    {
      id: 'v1-script-execute-success',
      name: 'V1 Automation Script Execution (success)',
      apiVersion: 'v1',
      category: 'script',
      request: {
        method: 'POST',
        path: '/api/v1/scripts/run',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-script-001',
        },
        body: {
          script_id: 'script-automation-001',
          user_id: 'prof-legacy-chrom-001',
          params: { timeout: 5000 },
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-script-001',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {
            job_id: 'job-script-001',
            status: 'queued',
          },
        },
      },
      sideEffects: {
        stateMutated: true,
      },
    },

    // 12. Cloud Sync - Status & Trigger
    {
      id: 'v1-sync-trigger-success',
      name: 'V1 Profile Cloud Sync Trigger (success)',
      apiVersion: 'v1',
      category: 'sync',
      request: {
        method: 'POST',
        path: '/api/v1/sync/profiles',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-sync-001',
        },
        body: {
          direction: 'push',
          profile_ids: ['prof-legacy-chrom-001'],
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-sync-001',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {
            sync_id: 'sync-op-001',
            status: 'synced',
            synced_count: 1,
          },
        },
      },
      sideEffects: {
        stateMutated: true,
      },
    },

    // 13. V2 API - Batch Profile Query (V2 specification)
    {
      id: 'v2-profiles-batch-query',
      name: 'V2 Profiles Batch Query Envelope',
      apiVersion: 'v2',
      category: 'bulk',
      request: {
        method: 'POST',
        path: '/api/v2/profiles/batch-query',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-v2-batch-001',
          'x-api-version': '2.0',
        },
        body: {
          filter: { status: 'all' },
          pagination: { page: 1, pageSize: 20 },
        },
      },
      response: {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'req-v2-batch-001',
        },
        body: {
          code: 0,
          msg: 'success',
          data: {
            items: [
              { id: 'prof-legacy-chrom-001', name: 'Legacy Test Chromium Profile', engine: 'chromium' },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        },
      },
    },
  ];

  return fixtures;
}

export interface GenerateCorpusOptions {
  outputPath?: string;
  outPath?: string;
  keyPair?: {
    publicKeyPem: string;
    privateKeyPem: string;
    keyId: string;
  };
  isolatedClonePath?: string;
}

export async function generateLegacyCorpus(
  options: GenerateCorpusOptions = {}
): Promise<SignedLegacyCorpusEnvelope> {
  let cloneManifest: CloneManifest | null = null;
  try {
    const sourceRoot = process.cwd();
    const cloneDir = options.isolatedClonePath || path.join(os.tmpdir(), `antidetect-legacy-clone-${Date.now()}`);
    cloneManifest = createIsolatedClone(sourceRoot, cloneDir);
  } catch {
    // If snapshot files are not present in current working environment, continue with self-contained fixture data
  }

  const sourceBuildSha256 = cloneManifest?.sourceBeforeSha256 || computeSha256(Buffer.from('antidetect-source-build-v1.0.0', 'utf8'));
  const cloneExecutableSha256 = cloneManifest?.executableSha256 || computeSha256(Buffer.from('antidetect-clone-executable-mock', 'utf8'));
  const cloneDbSha256 = cloneManifest?.dbSha256 || computeSha256(Buffer.from('antidetect-clone-db-mock', 'utf8'));
  const cloneFilesystemInventorySha256 = cloneManifest?.filesystemInventorySha256 || computeSha256(Buffer.from('antidetect-inventory-mock', 'utf8'));
  // 2. Generate legacy fixtures
  const fixtures = generateLegacyFixtures();
  const canonicalFixturesJson = canonicalizeJson(fixtures);
  const fixtureSetSha256 = computeSha256(Buffer.from(canonicalFixturesJson, 'utf8'));

  // 3. Generate or use Ed25519 key pair
  const keyPair = options.keyPair || generateEd25519KeyPair();

  // 4. Build canonical corpus data
  const corpusData = {
    schemaVersion: '1',
    createdAt: new Date().toISOString(),
    sourceBuildSha256,
    cloneExecutableSha256,
    cloneDbSha256,
    cloneFilesystemInventorySha256,
    apiVersions: ['v1', 'v2'],
    fixtureSetSha256,
    fixtures,
  };

  const canonicalCorpusDataJson = canonicalizeJson(corpusData);
  const corpusSha256 = computeSha256(Buffer.from(canonicalCorpusDataJson, 'utf8'));
  const contentAddress = `urn:sha256:${corpusSha256}`;

  // 5. Assemble payload for signing
  const payloadWithoutSignature: LegacyCorpusPayload = {
    schemaVersion: '1',
    corpusSha256,
    contentAddress,
    createdAt: corpusData.createdAt,
    sourceBuildSha256,
    cloneExecutableSha256,
    cloneDbSha256,
    cloneFilesystemInventorySha256,
    apiVersions: ['v1', 'v2'],
    fixtureSetSha256,
    keyId: keyPair.keyId,
    publicKeyPem: keyPair.publicKeyPem,
    signatureAlgorithm: 'Ed25519',
    domain: DOMAIN_SEPARATOR_LEGACY_CORPUS,
    fixtures,
  };

  // 6. Sign payload with domain separation
  const signature = signLegacyCorpus(payloadWithoutSignature as unknown as Record<string, unknown>, keyPair.privateKeyPem);

  const signedEnvelope: SignedLegacyCorpusEnvelope = {
    ...payloadWithoutSignature,
    signature,
  };
  // 7. Write to output
  const outputPath = options.outputPath || options.outPath || DEFAULT_CORPUS_OUT_PATH;
  const targetDir = path.dirname(outputPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, canonicalizeJson(signedEnvelope), 'utf8');

  if (cloneManifest) {
    cloneManifest.cleanup();
  }

  return signedEnvelope;
}

if (require.main === module) {
  generateLegacyCorpus()
    .then((envelope) => {
      console.log(`Successfully generated and signed legacy corpus: ${envelope.contentAddress}`);
    })
    .catch((err) => {
      console.error('Failed to generate legacy corpus:', err);
      process.exit(1);
    });
}
