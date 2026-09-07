import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkCoherence, runPreflight } from '../../../src/main/preflight/preflightService';
import type { CheckVerdict } from '../../../src/main/preflight/types';
import { PREFLIGHT_REASON } from '../../../src/main/preflight/types';
import { EXTENDED_FINGERPRINT_CATALOG } from '../../../src/main/fingerprints/catalog';
import { deriveHardwareVector } from '../../../src/main/fingerprints/derivation';

vi.mock('../../../src/main/db', () => ({
  getDb: vi.fn(),
}));

const dbModule = await import('../../../src/main/db');

function mockDb(profileRow: unknown, fpRow: unknown): void {
  const dbMock = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM profiles')) {
        return { get: vi.fn(() => profileRow) };
      }
      if (sql.includes('FROM fingerprints')) {
        return { get: vi.fn(() => fpRow) };
      }
      return { get: vi.fn() };
    }),
  };
  vi.mocked(dbModule.getDb).mockReturnValue(dbMock as unknown as ReturnType<typeof dbModule.getDb>);
}

describe('checkCoherence (fingerprint-catalog 3.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes without evaluation when profile has no fingerprint', () => {
    mockDb({ id: 'p1', fingerprint_id: null }, undefined);
    const res = checkCoherence('p1');
    expect(res.status).toBe('pass');
    expect(res.reasonCode).toBe(PREFLIGHT_REASON.COHERENCE_NOT_CONFIGURED);
  });

  it('passes without evaluation when fingerprint record is missing', () => {
    mockDb({ id: 'p1', fingerprint_id: 'fp_x' }, undefined);
    const res = checkCoherence('p1');
    expect(res.status).toBe('pass');
    expect(res.reasonCode).toBe(PREFLIGHT_REASON.COHERENCE_NOT_CONFIGURED);
  });

  it('returns pass with catalog family identified for a valid derived vector', () => {
    const seedVector = deriveHardwareVector(123456789);
    const family = EXTENDED_FINGERPRINT_CATALOG.find((f) => f.id === seedVector.familyId);
    expect(family).toBeDefined();
    mockDb({ id: 'p1', fingerprint_id: 'fp_x' }, { seed: 123456789, config_json: '{}' });
    const res = checkCoherence('p1');
    expect(res.status).toBe('pass');
    expect(res.reasonCode).toBe('coherence-pass');
    expect(res.detail).toContain(family!.id);
  });

  it('legacy unparseable config never fails the preflight (non-blocking migration contract)', () => {
    mockDb({ id: 'p1', fingerprint_id: 'fp_x' }, { seed: 42, config_json: 'not-json{{{' });
    const res = checkCoherence('p1');
    // Legacy configs carry only sparse overrides: derivation still resolves a
    // catalog family and passes, or falls back to warn — never 'fail'.
    expect(['pass', 'warn']).toContain(res.status);
    expect(res.status).not.toBe('fail');
  });

  it('includes coherence in runPreflight checkList as a named check', async () => {
    // Full-pipeline smoke through mocked db: profile with fingerprint, proxy lookups mocked.
    const dbMock = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('FROM profiles WHERE id = ?')) {
          return {
            get: vi.fn(() => ({ id: 'p1', fingerprint_id: 'fp_x', proxy_id: null, timezone: null })),
          };
        }
        if (sql.includes('FROM fingerprints')) {
          return { get: vi.fn(() => ({ seed: 123456789, config_json: '{}' })) };
        }
        if (sql.includes('FROM proxies')) {
          return { get: vi.fn(() => undefined) };
        }
        return { get: vi.fn(() => undefined), all: vi.fn(() => []) };
      }),
    };
    vi.mocked(dbModule.getDb).mockReturnValue(dbMock as unknown as ReturnType<typeof dbModule.getDb>);

    const verdict = await runPreflight('p1');
    const names = verdict.checkList.map((c) => c.name);
    expect(names).toContain('coherence');
    expect(verdict.checks['coherence']).toBeDefined();
  });
});