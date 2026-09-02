import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { canonicalizeJson } from '../src/main/security';

export interface SbomComponent {
  name: string;
  version: string;
  purl?: string;
  type?: string;
  resolved?: string;
  integrity?: string;
}

export interface SbomDocument {
  bomFormat: 'CycloneDX';
  specVersion: string;
  serialNumber: string;
  version: number;
  metadata: {
    timestamp: string;
    tools: Array<{ vendor: string; name: string; version: string }>;
    component: {
      name: string;
      version: string;
      type: string;
    };
  };
  components: SbomComponent[];
}

export function generateSbom(projectRoot: string): SbomDocument {
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  const pkgLockPath = path.join(projectRoot, 'package-lock.json');

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(pkgLockPath, 'utf8'));

  const components: SbomComponent[] = [];
  const packages = lock.packages || {};

  for (const [pkgPath, meta] of Object.entries<any>(packages)) {
    if (!pkgPath || pkgPath === '') continue; // root
    const cleanName = pkgPath.replace(/^node_modules\//, '');
    components.push({
      name: cleanName,
      version: meta.version || 'unknown',
      resolved: meta.resolved,
      integrity: meta.integrity,
      type: 'library',
      purl: `pkg:npm/${cleanName}@${meta.version || 'unknown'}`,
    });
  }

  // Sort components by name and version for deterministic output
  components.sort((a, b) => {
    const cmp = a.name.localeCompare(b.name);
    return cmp !== 0 ? cmp : a.version.localeCompare(b.version);
  });

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.4',
    serialNumber: `urn:uuid:${Date.now().toString(16)}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'antidetect',
          name: 'secure-runtime-supply-chain-sbom',
          version: '1.0.0',
        },
      ],
      component: {
        name: pkg.name || 'antidetect-browser',
        version: pkg.version || '0.0.0',
        type: 'application',
      },
    },
    components,
  };
}

export function verifySbom(sbom: SbomDocument, projectRoot: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (sbom.bomFormat !== 'CycloneDX') {
    errors.push(`Unsupported BOM format: ${sbom.bomFormat}`);
  }
  if (!sbom.components || !Array.isArray(sbom.components)) {
    errors.push('BOM missing components array');
    return { valid: false, errors };
  }

  const pkgLockPath = path.join(projectRoot, 'package-lock.json');
  if (fs.existsSync(pkgLockPath)) {
    const lock = JSON.parse(fs.readFileSync(pkgLockPath, 'utf8'));
    const packages = lock.packages || {};
    const lockPackageCount = Object.keys(packages).filter((p) => p !== '').length;

    if (Math.abs(sbom.components.length - lockPackageCount) > 10) {
      errors.push(`Component count discrepancy: SBOM has ${sbom.components.length}, lockfile has ${lockPackageCount}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function main() {
  const args = process.argv.slice(2);
  let outPath = path.join(process.cwd(), 'sbom.cyclonedx.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) outPath = args[++i];
  }

  const sbom = generateSbom(process.cwd());
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(sbom, null, 2), 'utf8');
  console.log(`Generated SBOM with ${sbom.components.length} components at ${outPath}`);

  const verification = verifySbom(sbom, process.cwd());
  if (!verification.valid) {
    console.error('SBOM verification failed:', verification.errors);
    process.exit(1);
  }
  console.log('SBOM verification succeeded.');
}

if (require.main === module) {
  main();
}
