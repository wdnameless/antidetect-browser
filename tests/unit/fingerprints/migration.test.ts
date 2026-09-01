import { describe, it, expect } from 'vitest';
import { migrateLegacySeed, crc32, deriveHardwareVector } from '../../../src/main/fingerprints/derivation';
import * as fs from 'fs';
import * as path from 'path';

describe('Fingerprint Legacy Migration & Deterministic Corpus', () => {
  it('correctly computes crc32 for string inputs', () => {
    expect(crc32('hello')).toBe(0x3610a686);
    expect(crc32('profile-12345')).toBe(2060126468);
  });

  it('migrates legacy seeds (0, negative, null, undefined) deterministically without randomness', () => {
    const profileId = 'test-profile-uuid-42';

    // Same profileId must yield identical migrated seed
    const seed1 = migrateLegacySeed(profileId, 0);
    const seed2 = migrateLegacySeed(profileId, -5);
    const seed3 = migrateLegacySeed(profileId, null);
    const seed4 = migrateLegacySeed(profileId, undefined);

    expect(seed1).toBeGreaterThanOrEqual(1);
    expect(seed1).toBeLessThanOrEqual(2147483647);
    expect(seed1).toBe(seed2);
    expect(seed2).toBe(seed3);
    expect(seed3).toBe(seed4);

    // Valid positive seed must be preserved
    expect(migrateLegacySeed(profileId, 42)).toBe(42);
    expect(migrateLegacySeed(profileId, 2147483647)).toBe(2147483647);

    // Seed > 2147483647 wraps deterministically into positive range
    const wrapped = migrateLegacySeed(profileId, 2147483648);
    expect(wrapped).toBeGreaterThanOrEqual(1);
    expect(wrapped).toBeLessThanOrEqual(2147483647);
  });

  it('matches frozen golden replay corpus forever', () => {
    const goldenCorpus = [
      {
        profileId: 'profile-alpha',
        legacySeed: 0,
        expectedMigratedSeed: 527646801,
        expectedFamily: 'win-nvidia-rtx-4060-desktop',
      },
      {
        profileId: 'profile-beta',
        legacySeed: -100,
        expectedMigratedSeed: 1125805504,
        expectedFamily: 'win-nvidia-rtx-3080-desktop',
      },
      {
        profileId: 'profile-gamma',
        legacySeed: null,
        expectedMigratedSeed: 198224202,
        expectedFamily: 'win-nvidia-rtx-4070-desktop',
      },
      {
        profileId: 'profile-fixed',
        legacySeed: 1337,
        expectedMigratedSeed: 1337,
        expectedFamily: 'win-nvidia-rtx-4060-desktop',
      },
    ];

    for (const item of goldenCorpus) {
      const migrated = migrateLegacySeed(item.profileId, item.legacySeed);
      expect(migrated).toBe(item.expectedMigratedSeed);
      const vector = deriveHardwareVector(migrated);
      expect(vector.familyId).toBe(item.expectedFamily);
    }
  });

  it('verifies NO Math.random is used across src/main/fingerprints modules', () => {
    const dir = path.resolve(process.cwd(), 'src/main/fingerprints');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      expect(content.includes('Math.random')).toBe(false);
    }
  });
});
