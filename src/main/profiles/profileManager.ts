import { randomUUID, randomInt } from 'crypto';
import * as path from 'path';
import { getDb } from '../db';
import { PROFILES_DIR } from '../config';
import { getEnabledExtensionPaths } from '../extensions/extensionManager';

export type ProxyType = 'http' | 'https' | 'socks5' | 'ssh';

export interface ProxyInput {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  privateKey?: string;
}

export type BrowserType = 'chromium' | 'firefox';

export interface CreateProfileInput {
  name?: string;
  group_id?: string;
  user_agent?: string;
  timezone?: string;
  proxy?: ProxyInput;
  proxy_id?: string;
  device_id?: string;
  browser_type?: BrowserType;
}

export interface ProfileRow {
  id: string;
  name: string | null;
  group_id: string | null;
  proxy_id: string | null;
  fingerprint_id: string | null;
  device_id: string | null;
  browser_type: string;
  user_agent: string | null;
  timezone: string | null;
  geolocation: string | null;
  cookies_json: string | null;
  start_urls: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface ProxyRow {
  id: string;
  type: ProxyType;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  private_key: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface FingerprintLaunch {
  seed: number;
  platform: string;
  platformVersion?: string;
  brand: string;
  brandVersion?: string;
  hardwareConcurrency?: number;
  timezone?: string;
  lang?: string;
  disableSpoofing?: string;
}

export interface DeviceEmulationConfig {
  mobile: boolean;
  ua?: string;
  screen?: { width: number; height: number; deviceScaleFactor?: number };
  touch?: boolean;
  maxTouchPoints?: number;
}

export interface SshTunnelConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  privateKey?: string;
}

export interface LaunchConfig {
  profileId: string;
  userDataDir: string;
  browserType?: 'chromium' | 'firefox';
  proxyServer?: string;
  proxyAuth?: { username: string; password: string };
  sshTunnel?: SshTunnelConfig;
  proxyTimezone?: string;
  fingerprintSeed: number;
  fingerprint?: FingerprintLaunch;
  deviceEmulation?: DeviceEmulationConfig;
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  cookies?: Array<Record<string, unknown>>;
  extensionPaths?: string[];
  userAgent?: string;
  timezone?: string;
}

export interface ProfileListItem {
  user_id: string;
  name: string | null;
  status: string;
  group_id: string | null;
}

export function createProfile(input: CreateProfileInput): string {
  const db = getDb();
  const now = Date.now();
  const profileId = 'p_' + randomUUID();

  let proxyId: string | null = null;
  if (input.proxy_id) {
    proxyId = input.proxy_id;
  } else if (input.proxy) {
    proxyId = 'x_' + randomUUID();
    db.prepare(
      `INSERT INTO proxies (id, type, host, port, username, password, private_key, country, timezone, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      proxyId,
      input.proxy.type,
      input.proxy.host,
      input.proxy.port,
      input.proxy.username ?? null,
      input.proxy.password ?? null,
      input.proxy.privateKey ?? null,
      null,
      null,
      'unknown',
      now
    );
  }

  const fpId = 'f_' + randomUUID();
  const seed = randomInt(1, 2147483647);
  db.prepare(
    `INSERT INTO fingerprints (id, label, seed, config_json, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(fpId, 'auto', seed, '{}', now);

  db.prepare(
    `INSERT INTO profiles
       (id, name, group_id, proxy_id, fingerprint_id, device_id, browser_type, user_agent, timezone,
        geolocation, cookies_json, start_urls, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    profileId,
    input.name ?? null,
    input.group_id ?? null,
    proxyId,
    fpId,
    input.device_id ?? null,
    input.browser_type ?? 'chromium',
    input.user_agent ?? null,
    input.timezone ?? null,
    null,
    null,
    null,
    'closed',
    now,
    now
  );

  return profileId;
}

/** Batch-create profiles (Sprint C). Proxies are assigned round-robin. */
export function batchCreateProfiles(opts: {
  count: number;
  namePrefix?: string;
  proxyIds?: string[];
  deviceId?: string;
}): string[] {
  const ids: string[] = [];
  const prefix = opts.namePrefix ?? 'profile';
  for (let i = 0; i < opts.count; i++) {
    const proxyId =
      opts.proxyIds && opts.proxyIds.length ? opts.proxyIds[i % opts.proxyIds.length] : undefined;
    const id = createProfile({ name: `${prefix}-${i + 1}`, proxy_id: proxyId, device_id: opts.deviceId });
    ids.push(id);
  }
  return ids;
}

/** Merge a config into the profile's fingerprint config_json (Tier 2). */
export function updateProfileFingerprint(userId: string, config: Record<string, unknown>): boolean {
  const db = getDb();
  const profile = getProfile(userId);
  if (!profile || !profile.fingerprint_id) return false;
  const fp = db
    .prepare('SELECT config_json FROM fingerprints WHERE id = ?')
    .get(profile.fingerprint_id) as { config_json: string } | undefined;
  if (!fp) return false;
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(fp.config_json || '{}') as Record<string, unknown>;
  } catch {
    cfg = {};
  }
  const merged = { ...cfg, ...config };
  db.prepare('UPDATE fingerprints SET config_json = ? WHERE id = ?').run(
    JSON.stringify(merged),
    profile.fingerprint_id
  );
  return true;
}

export function getProfile(id: string): ProfileRow | undefined {
  return getDb()
    .prepare('SELECT * FROM profiles WHERE id = ?')
    .get(id) as ProfileRow | undefined;
}

export function setStatus(id: string, status: string): void {
  getDb()
    .prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id);
}

export function updateProfile(
  id: string,
  updates: {
    name?: string;
    group_id?: string | null;
    proxy_id?: string | null;
    device_id?: string | null;
    geolocation?: string | null;
  }
): boolean {
  const db = getDb();
  const profile = getProfile(id);
  if (!profile) return false;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    params.push(updates.name);
  }
  if (updates.group_id !== undefined) {
    sets.push('group_id = ?');
    params.push(updates.group_id);
  }
  if (updates.proxy_id !== undefined) {
    sets.push('proxy_id = ?');
    params.push(updates.proxy_id);
  }
  if (updates.device_id !== undefined) {
    sets.push('device_id = ?');
    params.push(updates.device_id);
  }
  if (updates.geolocation !== undefined) {
    sets.push('geolocation = ?');
    params.push(updates.geolocation);
  }

  if (sets.length === 0) return true;

  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);

  db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return true;
}

export function randomizeProfileFingerprint(id: string): number | null {
  const db = getDb();
  const profile = getProfile(id);
  if (!profile || !profile.fingerprint_id) return null;

  const newSeed = randomInt(1, 2147483647);
  db.prepare('UPDATE fingerprints SET seed = ? WHERE id = ?').run(newSeed, profile.fingerprint_id);
  return newSeed;
}

export interface GroupItem {
  id: string;
  name: string;
  created_at: number;
  profile_count: number;
}

export function createGroup(name: string): string {
  const db = getDb();
  const id = 'g_' + randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now);
  return id;
}

export function updateGroup(id: string, name: string): boolean {
  const res = getDb().prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id);
  return res.changes > 0;
}

export function deleteGroup(id: string): boolean {
  const db = getDb();
  db.prepare('UPDATE profiles SET group_id = NULL WHERE group_id = ?').run(id);
  const res = db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  return res.changes > 0;
}

export function listGroups(): GroupItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.created_at, COUNT(p.id) AS profile_count
       FROM groups g
       LEFT JOIN profiles p ON p.group_id = g.id
       GROUP BY g.id
       ORDER BY g.created_at DESC`
    )
    .all() as Array<{ id: string; name: string; created_at: number; profile_count: number }>;
  return rows;
}

export function listProfiles(
  page: number,
  pageSize: number,
  groupId?: string | null
): { list: ProfileListItem[]; total: number } {
  const db = getDb();
  let where = '';
  const params: unknown[] = [];
  if (groupId !== undefined && groupId !== null && groupId !== '') {
    where = ' WHERE group_id = ?';
    params.push(groupId);
  }

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM profiles${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT id, name, status, group_id FROM profiles${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Array<{
    id: string;
    name: string | null;
    status: string;
    group_id: string | null;
  }>;
  const list = rows.map((r) => ({
    user_id: r.id,
    name: r.name,
    status: r.status,
    group_id: r.group_id,
  }));
  return { list, total };
}

export function resolveLaunchConfig(id: string): LaunchConfig {
  const db = getDb();
  const profile = getProfile(id);
  if (!profile) throw new Error('profile not found');

  let fingerprintSeed = 0;
  let fingerprint: FingerprintLaunch | undefined;
  if (profile.fingerprint_id) {
    const fp = db
      .prepare('SELECT seed, config_json FROM fingerprints WHERE id = ?')
      .get(profile.fingerprint_id) as { seed: number; config_json: string } | undefined;
    if (fp) {
      fingerprintSeed = fp.seed;
      let fpCfg: Record<string, unknown> = {};
      try {
        fpCfg = JSON.parse(fp.config_json || '{}') as Record<string, unknown>;
      } catch {
        fpCfg = {};
      }
      fingerprint = {
        seed: fp.seed,
        platform: typeof fpCfg.platform === 'string' ? fpCfg.platform : 'windows',
        brand: typeof fpCfg.brand === 'string' ? fpCfg.brand : 'Chrome',
        brandVersion: typeof fpCfg.brandVersion === 'string' ? fpCfg.brandVersion : undefined,
        hardwareConcurrency:
          typeof fpCfg.hardwareConcurrency === 'number' ? fpCfg.hardwareConcurrency : undefined,
        timezone: profile.timezone ?? undefined,
        lang: typeof fpCfg.lang === 'string' ? fpCfg.lang : 'en-US',
        disableSpoofing: typeof fpCfg.disableSpoofing === 'string' ? fpCfg.disableSpoofing : undefined,
      };
    }
  }

  // Device preset (Phase 4): desktop presets override kernel fingerprint parameters;
  // mobile presets are emulated at the CDP layer.
  let deviceEmulation: DeviceEmulationConfig | undefined;
  if (profile.device_id) {
    const dev = db
      .prepare('SELECT config_json FROM devices WHERE id = ?')
      .get(profile.device_id) as { config_json: string } | undefined;
    if (dev) {
      let devCfg: Record<string, unknown> = {};
      try {
        devCfg = JSON.parse(dev.config_json || '{}') as Record<string, unknown>;
      } catch {
        devCfg = {};
      }
      if (devCfg.mobile === true) {
        const screenRaw = devCfg.screen as { width?: unknown; height?: unknown; deviceScaleFactor?: unknown } | undefined;
        deviceEmulation = {
          mobile: true,
          ua: typeof devCfg.ua === 'string' ? devCfg.ua : undefined,
          screen: screenRaw
            ? {
                width: Number(screenRaw.width) || 393,
                height: Number(screenRaw.height) || 852,
                deviceScaleFactor: Number(screenRaw.deviceScaleFactor) || 1,
              }
            : undefined,
          touch: devCfg.touch === true,
          maxTouchPoints: typeof devCfg.maxTouchPoints === 'number' ? devCfg.maxTouchPoints : undefined,
        };
      } else if (fingerprint) {
        // Desktop preset: override kernel fingerprint parameters.
        if (typeof devCfg.platform === 'string') fingerprint.platform = devCfg.platform;
        if (typeof devCfg.platformVersion === 'string') fingerprint.platformVersion = devCfg.platformVersion;
        if (typeof devCfg.brand === 'string') fingerprint.brand = devCfg.brand;
        if (typeof devCfg.brandVersion === 'string') fingerprint.brandVersion = devCfg.brandVersion;
        if (typeof devCfg.disableSpoofing === 'string') fingerprint.disableSpoofing = devCfg.disableSpoofing;
        if (typeof devCfg.hardwareConcurrency === 'number') {
          fingerprint.hardwareConcurrency = devCfg.hardwareConcurrency;
        }
        if (typeof devCfg.lang === 'string') fingerprint.lang = devCfg.lang;
        if (typeof devCfg.timezone === 'string') fingerprint.timezone = devCfg.timezone;
      }
    }
  }

  let proxyServer: string | undefined;
  let proxyAuth: { username: string; password: string } | undefined;
  let sshTunnel: SshTunnelConfig | undefined;
  let proxyTimezone: string | undefined;
  if (profile.proxy_id) {
    const px = db
      .prepare('SELECT * FROM proxies WHERE id = ?')
      .get(profile.proxy_id) as ProxyRow | undefined;
    if (px) {
      proxyTimezone = px.timezone ?? undefined;
      if (px.type === 'ssh') {
        // SSH proxies are tunneled locally (launcher creates a SOCKS5 endpoint).
        sshTunnel = {
          host: px.host,
          port: px.port,
          username: px.username ?? undefined,
          password: px.password ?? undefined,
          privateKey: px.private_key ?? undefined,
        };
      } else {
        const scheme = px.type;
        proxyServer = `${scheme}://${px.host}:${px.port}`;
        if (px.username && px.password) {
          proxyAuth = { username: px.username, password: px.password };
        }
      }
    }
  }

  // Geolocation (Sprint A): stored as JSON on the profile.
  let geolocation: { latitude: number; longitude: number; accuracy?: number } | undefined;
  if (profile.geolocation) {
    try {
      const geo = JSON.parse(profile.geolocation) as Record<string, unknown>;
      if (typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
        geolocation = {
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy: typeof geo.accuracy === 'number' ? geo.accuracy : undefined,
        };
      }
    } catch {
      // ignore invalid JSON
    }
  }

  // Cookies (Sprint A): stored as a JSON array on the profile.
  let cookies: Array<Record<string, unknown>> | undefined;
  if (profile.cookies_json) {
    try {
      const parsedCookies = JSON.parse(profile.cookies_json);
      if (Array.isArray(parsedCookies) && parsedCookies.length) {
        cookies = parsedCookies as Array<Record<string, unknown>>;
      }
    } catch {
      // ignore invalid JSON
    }
  }

  // Extensions (Sprint B): on-disk paths of bound extensions.
  const extPaths = getEnabledExtensionPaths(id);

  return {
    profileId: id,
    userDataDir: path.join(PROFILES_DIR, id),
    browserType: profile.browser_type === 'firefox' ? 'firefox' : 'chromium',
    proxyServer,
    proxyAuth,
    sshTunnel,
    proxyTimezone,
    fingerprintSeed,
    fingerprint,
    deviceEmulation,
    geolocation,
    cookies,
    extensionPaths: extPaths.length ? extPaths : undefined,
    userAgent: profile.user_agent ?? undefined,
    timezone: profile.timezone ?? undefined,
  };
}
