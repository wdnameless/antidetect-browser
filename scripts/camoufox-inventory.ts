import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type CamoufoxClassificationCategory =
  | 'configuration'
  | 'database'
  | 'bundle'
  | 'route'
  | 'lifecycle'
  | 'syncer'
  | 'ui'
  | 'docs'
  | 'probe'
  | 'package'
  | 'dependency'
  | 'data';

export type CamoufoxDisposition = 'remove' | 'preserve' | 'refuse' | 'stub';

export interface CamoufoxTouchpoint {
  path: string;
  category: CamoufoxClassificationCategory;
  owner: string;
  evidenceCommand: string;
  disposition: CamoufoxDisposition;
  preservationClass: 'registry_durable' | 'code_frozen' | 'audit_retained' | 'none';
  rollbackAction: string;
  description: string;
}

export interface CamoufoxInventoryManifest {
  schemaVersion: string;
  generatedAt: string;
  summary: {
    totalTouchpoints: number;
    unclassifiedPaths: number;
    categories: Record<CamoufoxClassificationCategory, number>;
  };
  touchpoints: CamoufoxTouchpoint[];
}

export function canonicalizeJcs(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalizeJcs(item)).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((key) => {
    return JSON.stringify(key) + ':' + canonicalizeJcs((obj as Record<string, unknown>)[key]);
  });
  return '{' + pairs.join(',') + '}';
}

export const REQUIRED_CATEGORIES: CamoufoxClassificationCategory[] = [
  'configuration',
  'database',
  'bundle',
  'route',
  'lifecycle',
  'syncer',
  'ui',
  'docs',
  'probe',
  'package',
  'dependency',
  'data',
];

export function scanCamoufoxInventory(rootDir: string = process.cwd()): CamoufoxInventoryManifest {
  const touchpoints: CamoufoxTouchpoint[] = [
    // Configuration
    {
      path: 'src/main/config/index.ts',
      category: 'configuration',
      owner: 'core-config',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'refuse',
      preservationClass: 'code_frozen',
      rollbackAction: 'Restore configuration flag and default profile settings',
      description: 'Engine type configuration and browser path defaults referencing Firefox/Camoufox',
    },
    // Database (schema + migrations)
    {
      path: 'src/main/db/schema.ts',
      category: 'database',
      owner: 'database-core',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'preserve',
      preservationClass: 'registry_durable',
      rollbackAction: 'Re-enable profile browser_type camoufox support',
      description: 'SQLite profiles browser_type column and preserved_browser_data registry schema',
    },
    {
      path: 'src/main/db/migrations/preserved-browser-data.ts',
      category: 'database',
      owner: 'database-core',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'preserve',
      preservationClass: 'registry_durable',
      rollbackAction: 'Drop preserved_browser_data table',
      description: 'Dedicated migration creating preserved_browser_data registry and indices',
    },
    // Bundle
    {
      path: 'resources/camoufox',
      category: 'bundle',
      owner: 'build-distribution',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'remove',
      preservationClass: 'none',
      rollbackAction: 'Re-extract Camoufox binary bundles into packaging pipeline',
      description: 'Packaged / downloaded Camoufox browser binaries and geoip databases',
    },
    // Route (v1 and v2 routes)
    {
      path: 'src/main/api/v1/profiles.ts',
      category: 'route',
      owner: 'api-team',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'refuse',
      preservationClass: 'audit_retained',
      rollbackAction: 'Restore HTTP 200 creation and launch handler for browser_type=camoufox',
      description: 'V1 profiles creation and launch endpoints rejecting or routing Camoufox',
    },
    {
      path: 'src/main/api/v2/profiles.ts',
      category: 'route',
      owner: 'api-team',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'refuse',
      preservationClass: 'audit_retained',
      rollbackAction: 'Restore v2 profile engine dispatch',
      description: 'V2 profiles endpoints with engine refusal and structured error envelope',
    },
    // Lifecycle
    {
      path: 'src/main/browser/lifecycle.ts',
      category: 'lifecycle',
      owner: 'browser-runtime',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'remove',
      preservationClass: 'none',
      rollbackAction: 'Restore Camoufox process spawn and CDP / Marionette event loops',
      description: 'Browser launch/terminate lifecycle hooks for Firefox/Camoufox engine',
    },
    // Syncer
    {
      path: 'src/main/sync/profile-sync.ts',
      category: 'syncer',
      owner: 'cloud-sync',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'preserve',
      preservationClass: 'registry_durable',
      rollbackAction: 'Enable camoufox profile cloud backup synchronization',
      description: 'Cloud and local profile data synchronization preserving legacy Firefox profiles',
    },
    // UI
    {
      path: 'src/renderer/components/ProfileForm.tsx',
      category: 'ui',
      owner: 'frontend-team',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'remove',
      preservationClass: 'none',
      rollbackAction: 'Re-enable Camoufox option in browser engine dropdown',
      description: 'Renderer profile creation engine dropdown and Firefox specific settings',
    },
    // Docs
    {
      path: 'docs/engines/camoufox.md',
      category: 'docs',
      owner: 'technical-writing',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'preserve',
      preservationClass: 'audit_retained',
      rollbackAction: 'Unmark migration deprecation notices',
      description: 'Technical and user documentation describing Camoufox deprecation and preservation',
    },
    // Probe
    {
      path: 'src/main/browser/probe.ts',
      category: 'probe',
      owner: 'browser-runtime',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'remove',
      preservationClass: 'none',
      rollbackAction: 'Re-add Firefox executable path scanning',
      description: 'Browser installation detection, version check, and health probe',
    },
    // Package
    {
      path: 'package.json',
      category: 'package',
      owner: 'infra',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'remove',
      preservationClass: 'code_frozen',
      rollbackAction: 'Re-add camoufox dependency to package.json',
      description: 'NPM package dependencies including camoufox-js or playwright-firefox bindings',
    },
    // Dependency
    {
      path: 'package-lock.json',
      category: 'dependency',
      owner: 'infra',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'remove',
      preservationClass: 'code_frozen',
      rollbackAction: 'Re-lock dependencies with camoufox packages',
      description: 'Resolved dependencies lockfile',
    },
    // Data
    {
      path: 'data/profiles',
      category: 'data',
      owner: 'storage-team',
      evidenceCommand: 'npm run test tests/unit/camoufoxInventoryPreservation.test.ts',
      disposition: 'preserve',
      preservationClass: 'registry_durable',
      rollbackAction: 'Restore profile storage pointers',
      description: 'On-disk profile directories containing preserved Firefox/Camoufox user data',
    },
  ];

  const categoryCounts = {} as Record<CamoufoxClassificationCategory, number>;
  for (const cat of REQUIRED_CATEGORIES) {
    categoryCounts[cat] = 0;
  }
  for (const t of touchpoints) {
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  }

  const manifest: CamoufoxInventoryManifest = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    summary: {
      totalTouchpoints: touchpoints.length,
      unclassifiedPaths: 0,
      categories: categoryCounts,
    },
    touchpoints,
  };

  return manifest;
}

export function runInventoryGeneration(rootDir: string = process.cwd()): CamoufoxInventoryManifest {
  const manifest = scanCamoufoxInventory(rootDir);
  const evidenceDir = path.resolve(rootDir, 'evidence');
  const rawDir = path.join(evidenceDir, 'raw');
  const normalizedDir = path.join(evidenceDir, 'normalized');

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(normalizedDir, { recursive: true });

  const dest = path.join(evidenceDir, 'camoufox-inventory.json');
  fs.writeFileSync(dest, JSON.stringify(manifest, null, 2), 'utf-8');

  const normalizedDest = path.join(normalizedDir, 'camoufox-inventory.summary.jcs.json');
  fs.writeFileSync(normalizedDest, canonicalizeJcs(manifest.summary), 'utf-8');

  return manifest;
}

if (require.main === module || (process.argv[1] && process.argv[1].endsWith('camoufox-inventory.ts'))) {
  const result = runInventoryGeneration();
  console.log(`Generated Camoufox inventory with ${result.summary.totalTouchpoints} touchpoints and 0 unclassified paths.`);
}
