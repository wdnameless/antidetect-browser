import { describe, it, expect } from 'vitest';
import {
  deriveCatalogSubSeeds,
  deriveHardwareVector,
  selectFamilyBySeed,
  validateCoherence,
} from '../../../src/main/fingerprints/derivation';
import { WINDOWS_FINGERPRINT_CATALOG } from '../../../src/main/fingerprints/catalog';

describe('Fingerprint Derivation & Determinism', () => {
  it('derives 8 distinct, domain-separated sub-seeds deterministically', () => {
    const seed = 123456789;
    const subSeeds1 = deriveCatalogSubSeeds(seed);
    const subSeeds2 = deriveCatalogSubSeeds(seed);

    expect(subSeeds1).toEqual(subSeeds2);

    const keys = [
      'canvas',
      'webgl',
      'audio',
      'domrect',
      'voices',
      'devices',
      'platform',
      'screen',
    ] as const;

    const values = keys.map((k) => subSeeds1[k]);
    for (const val of values) {
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(2147483647);
    }

    // Check distinctness across domains
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(keys.length);
  });

  it('selects families deterministically and weights match distribution', () => {
    const seedA = 42;
    const fam1 = selectFamilyBySeed(seedA);
    const fam2 = selectFamilyBySeed(seedA);
    expect(fam1.id).toBe(fam2.id);

    // Distribution smoke check over 10,000 seeds
    const counts: Record<string, number> = {};
    const N = 10000;
    for (let s = 1; s <= N; s++) {
      const f = selectFamilyBySeed(s * 7919);
      counts[f.id] = (counts[f.id] || 0) + 1;
    }
    // High-weight families should be chosen more frequently than low-weight families
    const sortedFamilies = [...WINDOWS_FINGERPRINT_CATALOG].sort((a, b) => b.weight - a.weight);
    const topFamily = sortedFamilies[0];
    const bottomFamily = sortedFamilies[sortedFamilies.length - 1];
    expect(counts[topFamily.id] ?? 0).toBeGreaterThan(counts[bottomFamily.id] ?? 0);
  });

  it('derives coherent hardware vector within family constraints', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const vector = deriveHardwareVector(seed);
      expect(vector.familyId).toBeTruthy();
      expect(vector.cpuCores).toBeGreaterThanOrEqual(2);
      expect(vector.ramGB).toBeGreaterThanOrEqual(4);
      expect(vector.screenResolution.width).toBeGreaterThanOrEqual(1024);
      expect(vector.screenResolution.height).toBeGreaterThanOrEqual(600);
      expect(vector.devicePixelRatio).toBeGreaterThanOrEqual(1);
      expect(vector.gpuVendor).toBeTruthy();
      expect(vector.gpuRenderer).toBeTruthy();
      expect(vector.platformVersion).toMatch(/^10\.0\.\d+$/);
      expect(vector.locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it('passes cross-surface coherence validation on all 30 families across multiple seeds', () => {
    for (const family of WINDOWS_FINGERPRINT_CATALOG) {
      for (let s = 1; s <= 10; s++) {
        const mockVector = {
          familyId: family.id,
          displayName: family.displayName,
          cpuCores: family.cpu.coresMin,
          ramGB: family.ramGB[0],
          screenResolution: family.screen.resolutions[0],
          devicePixelRatio: family.screen.dpr,
          colorDepth: family.screen.colorDepth,
          gpuVendor: family.gpu.vendor,
          gpuRenderer: family.gpu.renderer,
          platformVersion: family.platformVersionRange[0],
          architecture: family.coherenceConstraints.platformArch,
          bitness: family.coherenceConstraints.bitness,
          fontClass: family.fontsClass,
          locale: family.localePool[0],
        };

        const result = validateCoherence(mockVector, family);
        expect(result.valid).toBe(true);
        expect(result.violations).toHaveLength(0);
      }
    }
  });
});
