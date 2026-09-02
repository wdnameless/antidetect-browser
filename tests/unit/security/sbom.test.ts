import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateSbom, verifySbom } from '../../../scripts/generate-sbom';

describe('SBOM Generation & Verification', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-sbom-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates CycloneDX SBOM and verifies component integrity against package-lock.json', () => {
    const pkgJson = {
      name: 'test-app',
      version: '1.0.0',
    };
    const pkgLock = {
      name: 'test-app',
      version: '1.0.0',
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/dep-a': { version: '1.2.3', resolved: 'https://registry.npmjs.org/dep-a', integrity: 'sha512-abc' },
        'node_modules/dep-b': { version: '2.0.0', resolved: 'https://registry.npmjs.org/dep-b', integrity: 'sha512-def' },
      },
    };

    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), JSON.stringify(pkgLock, null, 2), 'utf8');

    const sbom = generateSbom(tmpDir);
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.components.length).toBe(2);
    expect(sbom.components[0].name).toBe('dep-a');
    expect(sbom.components[0].version).toBe('1.2.3');
    expect(sbom.components[1].name).toBe('dep-b');
    expect(sbom.components[1].version).toBe('2.0.0');

    const result = verifySbom(sbom, tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
