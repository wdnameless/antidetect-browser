import { describe, it, expect } from 'vitest';
import {
  LINUX_DESKTOP_FAMILIES,
  validateFamilyCoherence,
  getCatalogFamilies,
  EXTENDED_FINGERPRINT_CATALOG,
} from '../../../src/main/fingerprints';
import type { FingerprintCatalogFamily } from '../../../src/main/fingerprints';

describe('Linux Desktop Fingerprint Catalog Suite', () => {
  it('contains exactly 6 curated Linux desktop families', () => {
    expect(LINUX_DESKTOP_FAMILIES).toHaveLength(6);
  });

  it('all 6 Linux desktop families have valid StatCounter citations and fontsClass linux-freetype', () => {
    for (const family of LINUX_DESKTOP_FAMILIES) {
      expect(family.platform).toBe('linux');
      expect(family.fontsClass).toBe('linux-freetype');
      expect(family.citation).toBeDefined();
      expect(family.citation.source).toContain('StatCounter');
      expect(family.weight).toBeGreaterThan(0);
    }
  });

  it('passes validateFamilyCoherence for all 6 Linux desktop families', () => {
    for (const family of LINUX_DESKTOP_FAMILIES) {
      const result = validateFamilyCoherence(family);
      expect(result.violations).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });


  it('returns Linux families when filtering by platform linux in getCatalogFamilies', () => {
    const linuxFamilies = getCatalogFamilies({ platform: 'linux' });
    expect(linuxFamilies.length).toBe(6);
    expect(linuxFamilies.every((f) => f.platform === 'linux')).toBe(true);
  });

  it('preserves catalog weight sum invariant', () => {
    const linuxWeightSum = LINUX_DESKTOP_FAMILIES.reduce((sum, f) => sum + f.weight, 0);
    expect(linuxWeightSum).toBeCloseTo(0.18, 5);
  });

  it('detects planted incoherence: macOS font class on Linux family yields violation naming field pair', () => {
    const coherent = LINUX_DESKTOP_FAMILIES[0];
    const incoherent: FingerprintCatalogFamily = {
      ...coherent,
      fontsClass: 'macos-modern' as unknown as FingerprintCatalogFamily['fontsClass'], // deliberately invalid for planted-incoherence test
    };
    const result = validateFamilyCoherence(incoherent);
    expect(result.violations.length).toBeGreaterThan(0);
    const fontViolation = result.violations.find((v) =>
      v.fieldPair.includes('fontsClass') && v.fieldPair.includes('platform')
    );
    expect(fontViolation).toBeDefined();
    expect(fontViolation?.message).toContain('linux-freetype');
  });

  it('detects planted incoherence: macOS system font in font inventory yields violation', () => {
    const coherent = LINUX_DESKTOP_FAMILIES[1];
    const incoherent: FingerprintCatalogFamily = {
      ...coherent,
      fontInventory: [...coherent.fontInventory, 'SF Pro'],
    };
    const result = validateFamilyCoherence(incoherent);
    expect(result.violations.length).toBeGreaterThan(0);
    const invViolation = result.violations.find((v) =>
      v.fieldPair.includes('fontInventory') && v.fieldPair.includes('platform')
    );
    expect(invViolation).toBeDefined();
    expect(invViolation?.message).toContain('macOS font');
  });

  it('detects planted incoherence: Windows system font in font inventory yields violation', () => {
    const coherent = LINUX_DESKTOP_FAMILIES[2];
    const incoherent: FingerprintCatalogFamily = {
      ...coherent,
      fontInventory: [...coherent.fontInventory, 'Segoe UI'],
    };
    const result = validateFamilyCoherence(incoherent);
    expect(result.violations.length).toBeGreaterThan(0);
    const invViolation = result.violations.find((v) =>
      v.fieldPair.includes('fontInventory') && v.fieldPair.includes('platform')
    );
    expect(invViolation).toBeDefined();
    expect(invViolation?.message).toContain('Windows font');
  });
});
