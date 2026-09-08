import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { initDb, getDb, closeDb } from '../../src/main/db';
import {
  createProfile,
  rotateFingerprints,
  setRunningChecker,
} from '../../src/main/profiles/profileManager';
import { EXTENDED_FINGERPRINT_CATALOG } from '../../src/main/fingerprints/catalog';

function readFingerprint(userId: string): { seed: number; cfg: Record<string, unknown> } | null {
  const profile = getDb()
    .prepare('SELECT fingerprint_id FROM profiles WHERE id = ?')
    .get(userId) as { fingerprint_id: string } | undefined;
  if (!profile?.fingerprint_id) return null;
  const fp = getDb()
    .prepare('SELECT seed, config_json FROM fingerprints WHERE id = ?')
    .get(profile.fingerprint_id) as { seed: number; config_json: string } | undefined;
  if (!fp) return null;
  return { seed: fp.seed, cfg: JSON.parse(fp.config_json || '{}') as Record<string, unknown> };
}

describe('bulk fingerprint rotation (parity program)', () => {
  beforeEach(async () => {
    closeDb();
    await initDb();
    setRunningChecker(() => false);
  });

  afterAll(() => {
    setRunningChecker(null as unknown as () => boolean);
    closeDb();
  });

  it('rotate changes seeds and stores a coherent family config', () => {
    const ids = [createProfile({ name: 'rot-a' }), createProfile({ name: 'rot-b' })];
    const before = ids.map(readFingerprint);
    const results = rotateFingerprints(ids, 'rotate');

    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(r.seed).toBeDefined();
      expect(r.family).toBeDefined();
      const family = EXTENDED_FINGERPRINT_CATALOG.find((f) => f.id === r.family);
      expect(family).toBeDefined();
    }
    ids.forEach((id, i) => {
      const after = readFingerprint(id);
      expect(after).not.toBeNull();
      expect(after!.seed).not.toBe(before[i]!.seed);
      expect(after!.cfg.family).toBeDefined();
      expect(after!.cfg.gpu).toBeDefined();
    });
  });

  it('running profiles are skipped and left untouched', () => {
    const stopped = createProfile({ name: 'skip-ok' });
    const running = createProfile({ name: 'skip-run' });
    const before = readFingerprint(running);
    setRunningChecker((id) => id === running);

    const results = rotateFingerprints([stopped, running], 'rotate');

    const runResult = results.find((r) => r.user_id === running);
    expect(runResult).toMatchObject({ ok: false, error: 'running' });
    expect(readFingerprint(running)).toEqual(before);
    expect(results.find((r) => r.user_id === stopped)?.ok).toBe(true);
  });

  it('incoherent patch is rejected per-item with issues and nothing persists', () => {
    const victim = createProfile({ name: 'patch-bad' });
    const before = readFingerprint(victim);
    // Force a known family, then patch RAM far outside its allowed set.
    const family = EXTENDED_FINGERPRINT_CATALOG[0];
    const coherentBefore = { ...before!.cfg, family: family.id };
    getDb()
      .prepare('UPDATE fingerprints SET config_json = ? WHERE id = (SELECT fingerprint_id FROM profiles WHERE id = ?)')
      .run(JSON.stringify(coherentBefore), victim);

    const badRam = (family.ramGB.reduce((m, v) => Math.max(m, v), 0) ?? 0) + 4096;
    const results = rotateFingerprints([victim], 'patch', { deviceMemory: badRam });

    expect(results[0]).toMatchObject({ ok: false, error: 'coherence' });
    expect(results[0].issues?.length).toBeGreaterThan(0);
    const after = readFingerprint(victim);
    expect(after!.cfg.deviceMemory).not.toBe(badRam);
    expect(after!.cfg.family).toBe(family.id);
  });

  it('coherent patch persists the targeted fields', () => {
    const id = createProfile({ name: 'patch-ok' });
    const results = rotateFingerprints([id], 'patch', { timezone: 'Europe/Berlin' });
    expect(results[0].ok).toBe(true);
    expect(readFingerprint(id)!.cfg.timezone).toBe('Europe/Berlin');
  });

  it('seed_hint replay is deterministic: same request twice gives identical seeds', () => {
    const id = createProfile({ name: 'replay' });
    const first = rotateFingerprints([id], 'rotate', undefined, 42);
    const firstSeed = first[0].seed;
    const firstCfg = readFingerprint(id)!.cfg;
    const second = rotateFingerprints([id], 'rotate', undefined, 42);
    expect(second[0].seed).toBe(firstSeed);
    expect(readFingerprint(id)!.cfg).toEqual(firstCfg);
  });
  it('a middle-item failure leaves siblings persisted (per-item atomicity)', () => {
    const ok1 = createProfile({ name: 'atom-1' });
    const bad = createProfile({ name: 'atom-2' });
    const ok2 = createProfile({ name: 'atom-3' });

    // Siblings get a fully coherent RTX 4090 family config; the middle one a
    // fully coherent 16GB-capped laptop config.
    const bigRamFamily = EXTENDED_FINGERPRINT_CATALOG.find((f) => f.id === 'win-nvidia-rtx-4090-desktop');
    const cappedFamily = EXTENDED_FINGERPRINT_CATALOG.find((f) => f.id === 'win-intel-iris-xe-g7-laptop');
    expect(bigRamFamily).toBeDefined();
    expect(cappedFamily).toBeDefined();
    const coherentCfg = (f: typeof bigRamFamily): Record<string, unknown> => ({
      platform: f!.coherenceConstraints.platform,
      brand: 'Chrome',
      family: f!.id,
      hardwareConcurrency: f!.cpu.coresMin,
      deviceMemory: f!.ramGB[0],
      lang: f!.localePool[0] ?? 'en-US',
      gpu: f!.gpu,
      screen: f!.screen,
    });
    for (const [id, fam] of [
      [ok1, bigRamFamily],
      [bad, cappedFamily],
      [ok2, bigRamFamily],
    ] as Array<[string, typeof bigRamFamily]>) {
      getDb()
        .prepare(
          'UPDATE fingerprints SET config_json = ? WHERE id = (SELECT fingerprint_id FROM profiles WHERE id = ?)'
        )
        .run(JSON.stringify(coherentCfg(fam)), id);
    }
    // 32GB RAM: inside the RTX 4090 family set [32,64], incoherent for the 16GB-capped one.
    const patchedRam = 32;

    const results = rotateFingerprints([ok1, bad, ok2], 'patch', { deviceMemory: patchedRam });

    expect(results.find((r) => r.user_id === ok1)?.ok).toBe(true);
    expect(results.find((r) => r.user_id === bad)).toMatchObject({ ok: false, error: 'coherence' });
    expect(results.find((r) => r.user_id === ok2)?.ok).toBe(true);
    expect(readFingerprint(ok1)!.cfg.deviceMemory).toBe(patchedRam);
    expect(readFingerprint(ok2)!.cfg.deviceMemory).toBe(patchedRam);
    expect(readFingerprint(bad)!.cfg.deviceMemory).not.toBe(patchedRam);
  });
});