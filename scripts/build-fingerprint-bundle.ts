import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { EXTENDED_FINGERPRINT_CATALOG } from '../src/main/fingerprints/catalog';

export function buildFingerprintBundle() {
  const families = EXTENDED_FINGERPRINT_CATALOG;
  const familiesJson = JSON.stringify(families);
  const sha256 = createHash('sha256').update(familiesJson).digest('hex');

  const bundle = {
    version: '2',
    generatedFrom: [
      'src/main/fingerprints/catalog.ts',
      'src/main/fingerprints/win11Families.ts',
      'src/main/fingerprints/macosFamilies.ts',
      'src/main/fingerprints/linuxFamilies.ts',
      'src/main/fingerprints/migration.ts',
    ],
    generatedAt: '2026-09-07T00:00:00.000Z',
    familiesCount: families.length,
    sha256,
    families,
  };

  const outDir = path.resolve(__dirname, '../assets/fingerprints');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'catalog-v2.json');
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf-8');
  console.log(`Successfully generated ${outPath} (${bundle.familiesCount} families, sha256: ${sha256})`);
  return bundle;
}

if (require.main === module || (typeof process !== 'undefined' && process.argv[1]?.includes('build-fingerprint-bundle'))) {
  buildFingerprintBundle();
}
