import { describe, it, expect } from 'vitest';
import { MOBILE_PRESETS, pickMobilePreset, buildMobileUa, getMobilePreset } from '../../src/main/devices/mobilePresets';

describe('mobilePresets', () => {
  it('pool has 30+ presets with unique ids', () => {
    expect(MOBILE_PRESETS.length).toBeGreaterThanOrEqual(30);
    const ids = new Set(MOBILE_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(MOBILE_PRESETS.length);
  });

  it('pickMobilePreset is deterministic for the same seed', () => {
    const a = pickMobilePreset(123456789);
    const b = pickMobilePreset(123456789);
    expect(a.id).toBe(b.id);
  });

  it('pickMobilePreset stays within the pool for edge seeds', () => {
    for (const seed of [0, 1, 2147483646, 4294967295]) {
      const preset = pickMobilePreset(seed);
      expect(MOBILE_PRESETS.some((p) => p.id === preset.id)).toBe(true);
    }
  });

  it('different seeds mostly pick different phones', () => {
    const picks = new Set(Array.from({ length: 50 }, (_, i) => pickMobilePreset(i * 7919).id));
    expect(picks.size).toBeGreaterThan(10);
  });

  it('buildMobileUa contains the model string and Android marker', () => {
    const preset = MOBILE_PRESETS[0];
    const ua = buildMobileUa(preset);
    expect(ua).toContain(preset.model);
    expect(ua).toContain('Android');
    expect(ua).toContain('Linux');
  });

  it('getMobilePreset resolves by id and returns undefined otherwise', () => {
    expect(getMobilePreset(MOBILE_PRESETS[0].id)?.id).toBe(MOBILE_PRESETS[0].id);
    expect(getMobilePreset('no-such-model')).toBeUndefined();
  });
});
