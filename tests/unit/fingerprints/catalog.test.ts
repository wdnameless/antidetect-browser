import { describe, it, expect } from 'vitest';
import { WINDOWS_FINGERPRINT_CATALOG } from '../../../src/main/fingerprints/catalog';

describe('Fingerprint Catalog Specifications', () => {
  it('contains EXACTLY 30 curated Windows families', () => {
    expect(WINDOWS_FINGERPRINT_CATALOG).toHaveLength(30);
  });

  it('has weights that sum to 1.000000 ± 1e-6', () => {
    const sum = WINDOWS_FINGERPRINT_CATALOG.reduce((acc, f) => acc + f.weight, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(1e-6);
  });

  it('has unique IDs across all 30 families', () => {
    const ids = new Set(WINDOWS_FINGERPRINT_CATALOG.map((f) => f.id));
    expect(ids.size).toBe(30);
  });

  it('has valid structure and market data citations for all families', () => {
    for (const family of WINDOWS_FINGERPRINT_CATALOG) {
      expect(family.id).toBeTruthy();
      expect(family.displayName).toBeTruthy();
      expect(family.weight).toBeGreaterThan(0);
      expect(family.citation.date).toMatch(/^2026-\d{2}/);
      expect(family.citation.source).toBeTruthy();
      expect(family.citation.notes).toBeTruthy();

      // GPU checks
      expect(family.gpu.vendor).toBeTruthy();
      expect(family.gpu.renderer).toBeTruthy();
      expect(family.gpu.limitsClass).toMatch(/^(integrated|budget|mid-range|high-end)$/);

      // CPU checks
      expect(family.cpu.coresMin).toBeGreaterThanOrEqual(2);
      expect(family.cpu.coresMax).toBeGreaterThanOrEqual(family.cpu.coresMin);
      expect(family.cpu.arch).toMatch(/^(x64|arm64|x86)$/);

      // RAM checks
      expect(family.ramGB.length).toBeGreaterThan(0);
      for (const ram of family.ramGB) {
        expect([4, 8, 12, 16, 24, 32, 64, 128]).toContain(ram);
      }

      // Screen checks
      expect(family.screen.resolutions.length).toBeGreaterThan(0);
      for (const res of family.screen.resolutions) {
        expect(res.width).toBeGreaterThanOrEqual(1024);
        expect(res.height).toBeGreaterThanOrEqual(600);
      }
      expect(family.screen.dpr).toBeGreaterThanOrEqual(1);
      expect(family.screen.colorDepth).toBeGreaterThanOrEqual(24);

      // Platform version checks
      expect(family.platformVersionRange.length).toBeGreaterThan(0);
      for (const pv of family.platformVersionRange) {
        expect(pv).toMatch(/^10\.0\.\d+$/);
      }

      // Fonts and Locales
      expect(family.fontsClass).toMatch(/^(win11-modern|win10-legacy|win11-arm)$/);
      expect(family.localePool.length).toBeGreaterThan(0);
      for (const loc of family.localePool) {
        expect(loc).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      }
    }
  });

  it('respects market-plausible distribution (integrated graphics majority)', () => {
    const igpuWeight = WINDOWS_FINGERPRINT_CATALOG.filter(
      (f) => f.gpu.limitsClass === 'integrated' || f.gpu.limitsClass === 'budget'
    ).reduce((acc, f) => acc + f.weight, 0);

    const highEndDesktopWeight = WINDOWS_FINGERPRINT_CATALOG.filter(
      (f) => f.gpu.limitsClass === 'high-end'
    ).reduce((acc, f) => acc + f.weight, 0);

    expect(igpuWeight).toBeGreaterThan(highEndDesktopWeight);
  });
});
