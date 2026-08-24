import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, getDb, closeDb } from '../../src/main/db';
import { createProfile, listProfiles } from '../../src/main/profiles/profileManager';
import { seedDevices } from '../../src/main/devices/deviceManager';

describe('listProfiles: pagination, search and filters', () => {
  beforeAll(async () => {
    await initDb();
    seedDevices();
    // 120 profiles with a common prefix; every 3rd bound to the Android device.
    const devices = getDb().prepare('SELECT id FROM devices').all() as Array<{ id: string }>;
    const android = devices.find((d) => d.id.includes('android'));
    for (let i = 1; i <= 120; i++) {
      createProfile({
        name: `pag-${String(i).padStart(3, '0')}`,
        device_id: i % 3 === 0 ? android?.id : undefined,
      });
    }
  });

  it('paginates: page 1 returns pageSize rows, total counts everything', () => {
    const p1 = listProfiles(1, 50);
    expect(p1.list.length).toBe(50);
    expect(p1.total).toBeGreaterThanOrEqual(120);
    const p3 = listProfiles(3, 50);
    expect(p3.list.length).toBeGreaterThanOrEqual(20);
    // pages do not overlap
    const ids1 = new Set(p1.list.map((r) => r.user_id));
    for (const row of p3.list) expect(ids1.has(row.user_id)).toBe(false);
  });

  it('search filters by name server-side', () => {
    const res = listProfiles(1, 500, null, 'pag-007');
    expect(res.total).toBe(1);
    expect(res.list[0]?.name).toBe('pag-007');
  });

  it('search matches profile id prefix too', () => {
    const any = listProfiles(1, 1);
    const idPart = any.list[0].user_id.slice(2, 10);
    const res = listProfiles(1, 500, null, idPart);
    expect(res.total).toBeGreaterThanOrEqual(1);
  });

  it('platform filter returns only profiles on that device platform', () => {
    const res = listProfiles(1, 500, null, null, 'android');
    expect(res.total).toBeGreaterThanOrEqual(1);
    for (const row of res.list) expect(row.platform).toBe('android');
  });

  it('status filter returns only matching statuses', () => {
    const res = listProfiles(1, 500, null, null, null, 'closed');
    expect(res.total).toBeGreaterThanOrEqual(120);
    for (const row of res.list) expect(row.status).toBe('closed');
    const running = listProfiles(1, 500, null, null, null, 'running');
    expect(running.total).toBe(0);
  });

  it('filters combine (AND semantics)', () => {
    const res = listProfiles(1, 500, null, 'pag-0', 'android', 'closed');
    for (const row of res.list) {
      expect(row.name).toContain('pag-0');
      expect(row.platform).toBe('android');
      expect(row.status).toBe('closed');
    }
  });

  it('closeDb is safe for the next test file', () => {
    closeDb();
    expect(true).toBe(true);
  });
});
