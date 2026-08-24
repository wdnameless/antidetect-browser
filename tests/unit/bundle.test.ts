import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, getDb, closeDb } from '../../src/main/db';
import { seedDevices } from '../../src/main/devices/deviceManager';
import {
  createProfile,
  exportProfileBundle,
  importProfileBundle,
  getProfile,
  type ProfileBundle,
} from '../../src/main/profiles/profileManager';

describe('profile bundles: export/import roundtrip', () => {
  let sourceId = '';
  let importedId = '';
  let bundle: ProfileBundle;

  beforeAll(async () => {
    await initDb();
    seedDevices();
    const devices = getDb().prepare('SELECT id FROM devices').all() as Array<{ id: string }>;
    const android = devices.find((d) => d.id.includes('android'));

    sourceId = createProfile({
      name: 'bundle-src',
      browser_type: 'chromium',
      device_id: android?.id,
      mobile_model_id: 'pixel_9',
      fingerprint_seed: 424242,
      timezone: 'Europe/Berlin',
      start_urls: ['https://example.com'],
      proxy: {
        type: 'socks5',
        host: '10.0.0.1',
        port: 1080,
        username: 'u1',
        password: 'p1',
      },
    });
    // attach cookies directly (as the cookies import route would)
    getDb()
      .prepare('UPDATE profiles SET cookies_json = ? WHERE id = ?')
      .run(JSON.stringify([{ name: 'sid', value: 'abc', domain: '.example.com' }]), sourceId);

    bundle = exportProfileBundle(sourceId) as ProfileBundle;
    importedId = importProfileBundle(bundle);
  });

  it('export contains fingerprint seed, proxy credentials and cookies', () => {
    expect(bundle.version).toBe(1);
    expect(bundle.profile.fingerprint?.seed).toBe(424242);
    expect(bundle.profile.proxy?.host).toBe('10.0.0.1');
    expect(bundle.profile.proxy?.username).toBe('u1');
    expect(bundle.profile.cookies?.length).toBe(1);
    expect(bundle.profile.start_urls).toEqual(['https://example.com']);
    expect(bundle.profile.mobile_model_id).toBe('pixel_9');
  });

  it('import creates a NEW profile (different id)', () => {
    expect(importedId).toBeTruthy();
    expect(importedId).not.toBe(sourceId);
  });

  it('imported profile preserves seed, proxy, cookies, device and timezone', () => {
    const src = getProfile(sourceId);
    const dst = getProfile(importedId);
    expect(dst).toBeDefined();

    // seed
    const srcSeed = getDb().prepare('SELECT seed FROM fingerprints WHERE id = ?').get(src?.fingerprint_id) as { seed: number };
    const dstSeed = getDb().prepare('SELECT seed FROM fingerprints WHERE id = ?').get(dst?.fingerprint_id) as { seed: number };
    expect(dstSeed.seed).toBe(srcSeed.seed);

    // proxy
    const srcPx = getDb().prepare('SELECT host, port, username FROM proxies WHERE id = ?').get(src?.proxy_id) as { host: string; port: number; username: string };
    const dstPx = getDb().prepare('SELECT host, port, username FROM proxies WHERE id = ?').get(dst?.proxy_id) as { host: string; port: number; username: string };
    expect(dstPx.host).toBe(srcPx.host);
    expect(dstPx.port).toBe(srcPx.port);
    expect(dstPx.username).toBe(srcPx.username);

    // cookies
    const dstRow = getDb().prepare('SELECT cookies_json FROM profiles WHERE id = ?').get(importedId) as { cookies_json: string };
    expect(JSON.parse(dstRow.cookies_json)).toEqual(bundle.profile.cookies);

    // device preset re-linked
    expect(dst?.device_id).toBe(src?.device_id);
    expect(dst?.timezone).toBe('Europe/Berlin');
    expect(dst?.mobile_model_id).toBe('pixel_9');
  });

  it('fingerprint config is carried over', () => {
    const src = getProfile(sourceId);
    const dst = getProfile(importedId);
    const srcCfg = getDb().prepare('SELECT config_json FROM fingerprints WHERE id = ?').get(src?.fingerprint_id) as { config_json: string };
    const dstCfg = getDb().prepare('SELECT config_json FROM fingerprints WHERE id = ?').get(dst?.fingerprint_id) as { config_json: string };
    expect(JSON.parse(dstCfg.config_json)).toEqual(JSON.parse(srcCfg.config_json));
  });

  it('rejects invalid bundles', () => {
    expect(() => importProfileBundle({ version: 2 } as unknown as ProfileBundle)).toThrow(/invalid bundle/);
    expect(() => importProfileBundle(null as unknown as ProfileBundle)).toThrow();
  });

  it('export returns null for unknown profile', () => {
    expect(exportProfileBundle('p_missing')).toBeNull();
  });

  it('closeDb is safe afterwards', () => {
    closeDb();
    expect(true).toBe(true);
  });
});
