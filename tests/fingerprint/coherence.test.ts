import { describe, it, expect } from 'vitest';
import { FingerprintCoherenceValidator, validateFamilyCoherence } from '../../src/main/fingerprints/validator';
import { EXTENDED_FINGERPRINT_CATALOG } from '../../src/main/fingerprints/catalog';
import type { FingerprintCatalogFamily } from '../../src/main/fingerprints/types';

describe('Task 2.4 - Audio Coherence Validation', () => {
  it('passes for valid macOS audio signature (sampleRate 48000 or 44100, 2 channels)', () => {
    const macFamily = EXTENDED_FINGERPRINT_CATALOG.find((f) => f.coherenceConstraints.platform === 'macos');
    expect(macFamily).toBeDefined();
    if (!macFamily) return;

    const res = FingerprintCoherenceValidator.validate(macFamily);
    expect(res.violations.filter((v) => v.fieldPair[0].startsWith('audioSignature'))).toEqual([]);
  });

  it('fails when macOS family has invalid audio sample rate (e.g. 96000)', () => {
    const macFamily = EXTENDED_FINGERPRINT_CATALOG.find((f) => f.coherenceConstraints.platform === 'macos');
    expect(macFamily).toBeDefined();
    if (!macFamily) return;

    const modified: FingerprintCatalogFamily = {
      ...macFamily,
      audioSignature: {
        ...macFamily.audioSignature!,
        sampleRate: 96000,
      },
    };

    const res = FingerprintCoherenceValidator.validate(modified);
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.fieldPair[0] === 'audioSignature.sampleRate')).toBe(true);
  });

  it('fails when audio channelCount is invalid (e.g. 1 or 8 channels)', () => {
    const winFamily = EXTENDED_FINGERPRINT_CATALOG.find((f) => f.coherenceConstraints.platform === 'windows');
    expect(winFamily).toBeDefined();
    if (!winFamily) return;

    const modified: FingerprintCatalogFamily = {
      ...winFamily,
      audioSignature: {
        ...winFamily.audioSignature!,
        channelCount: 4,
      },
    };

    const res = FingerprintCoherenceValidator.validate(modified);
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.fieldPair[0] === 'audioSignature.channelCount')).toBe(true);
  });

  it('enforces Linux sample rate of 44100 or 48000 (PulseAudio/PipeWire), rejecting exotic rates', () => {
    const linuxFamily = EXTENDED_FINGERPRINT_CATALOG.find((f) => f.coherenceConstraints.platform === 'linux');
    expect(linuxFamily).toBeDefined();
    if (!linuxFamily) return;

    // 48000 (PipeWire default) must pass.
    const pipeWire: FingerprintCatalogFamily = {
      ...linuxFamily,
      audioSignature: {
        ...linuxFamily.audioSignature!,
        sampleRate: 48000,
      },
    };
    expect(FingerprintCoherenceValidator.validate(pipeWire).valid).toBe(true);

    // An exotic rate must fail.
    const exotic: FingerprintCatalogFamily = {
      ...linuxFamily,
      audioSignature: {
        ...linuxFamily.audioSignature!,
        sampleRate: 96000,
      },
    };
    const res = FingerprintCoherenceValidator.validate(exotic);
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.fieldPair[0] === 'audioSignature.sampleRate')).toBe(true);
  });
});
