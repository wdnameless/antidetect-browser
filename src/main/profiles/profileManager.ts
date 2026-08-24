import { randomUUID, randomInt } from 'crypto';
import * as path from 'path';
import { getDb } from '../db';
import { PROFILES_DIR } from '../config';
import { getEnabledExtensionPaths } from '../extensions/extensionManager';
import { checkProxy, type ProxyCheckResult } from '../proxy/proxyManager';
import { pickMobilePreset, buildMobileUa, getMobilePreset, type MobilePreset } from '../devices/mobilePresets';

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
  proxy_id?: string;
  proxy?: ProxyInput;
  device_id?: string;
  fingerprint_seed?: number;
  user_agent?: string;
  timezone?: string;
  browser_type?: BrowserType;
  geolocation?: string;
  start_urls?: string[];
  /** Explicit mobile model from the pool (fixed "phone" for long-lived accounts). */
  mobile_model_id?: string;
}

export interface ProfileRow {
  id: string;
  name: string | null;
  group_id: string | null;
  proxy_id: string | null;
  fingerprint_id: string | null;
  device_id: string | null;
  browser_type: string | null;
  user_agent: string | null;
  timezone: string | null;
  geolocation: string | null;
  mobile_model_id: string | null;
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
  country: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
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

export interface StealthConfig {
  mobile: boolean;
  logicalPlatform: 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  ua?: string;
  model?: string;
  platformVersion?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
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
  stealth?: StealthConfig;
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  cookies?: Array<Record<string, unknown>>;
  extensionPaths?: string[];
  startUrls?: string[];
  userAgent?: string;
  timezone?: string;
}

export interface ProfileListItem {
  user_id: string;
  name: string | null;
  status: string;
  group_id: string | null;
  proxy_type?: string | null;
  proxy_host?: string | null;
  proxy_port?: number | null;
  proxy_country?: string | null;
  fingerprint_seed?: number | null;
  platform?: string | null;
  device_name?: string | null;
}

export interface ProfileDetails {
  user_id: string;
  name: string | null;
  status: string;
  group_id: string | null;
  device_id: string | null;
  browser_type: string;
  user_agent: string | null;
  timezone: string | null;
  proxy?: {
    id: string;
    type: ProxyType;
    host: string;
    port: number;
    username: string | null;
    country: string | null;
    timezone: string | null;
    status: string;
  } | null;
  fingerprint?: {
    seed: number;
    platform: string;
    hardwareConcurrency?: number;
    brand?: string;
  } | null;
  device?: {
    id: string;
    name: string;
    platform: string;
    config: Record<string, unknown>;
  } | null;
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

  const seed = typeof input.fingerprint_seed === 'number' && input.fingerprint_seed > 0
    ? input.fingerprint_seed
    : randomInt(1, 2147483647);
  const fpId = 'fp_' + randomUUID();
  const defaultFpConfig = JSON.stringify({
    platform: 'windows',
    brand: 'Chrome',
    hardwareConcurrency: 8,
    lang: 'en-US',
  });
  db.prepare(
    'INSERT INTO fingerprints (id, label, seed, config_json, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(fpId, 'default', seed, defaultFpConfig, now);

  db.prepare(
    `INSERT INTO profiles (
       id, name, group_id, proxy_id, fingerprint_id, device_id,
       browser_type, user_agent, timezone, geolocation, start_urls, mobile_model_id, status,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`
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
    input.geolocation ?? null,
    input.start_urls && input.start_urls.length ? JSON.stringify(input.start_urls) : null,
    input.mobile_model_id ?? null,
    now,
    now
  );

  return profileId;
}

export function batchCreateProfiles(input: {
  count: number;
  namePrefix?: string;
  proxyIds?: string[];
  deviceId?: string;
}): string[] {
  const prefix = input.namePrefix || 'profile';
  const proxyList = input.proxyIds && input.proxyIds.length ? input.proxyIds : [];
  const ids: string[] = [];

  for (let i = 1; i <= input.count; i++) {
    const name = `${prefix}-${String(i).padStart(3, '0')}`;
    const proxyId = proxyList.length > 0 ? proxyList[(i - 1) % proxyList.length] : undefined;
    const id = createProfile({
      name,
      proxy_id: proxyId,
      device_id: input.deviceId,
    });
    ids.push(id);
  }
  return ids;
}

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

export function duplicateProfile(userId: string, newName?: string): string | null {
  const source = getProfile(userId);
  if (!source) return null;

  const targetName = newName?.trim() || (source.name ? `${source.name} (Copy)` : 'Profile (Copy)');

  return createProfile({
    name: targetName,
    group_id: source.group_id || undefined,
    proxy_id: source.proxy_id || undefined,
    device_id: source.device_id || undefined,
    browser_type: (source.browser_type as BrowserType) || 'chromium',
    user_agent: source.user_agent || undefined,
    timezone: source.timezone || undefined,
    geolocation: source.geolocation || undefined,
    mobile_model_id: source.mobile_model_id || undefined,
  });
}

export function getProfile(id: string): ProfileRow | undefined {
  return getDb()
    .prepare('SELECT * FROM profiles WHERE id = ?')
    .get(id) as ProfileRow | undefined;
}

export function getProfileDetails(id: string): ProfileDetails | null {
  const db = getDb();
  const p = getProfile(id);
  if (!p) return null;

  let proxy: ProfileDetails['proxy'] = null;
  if (p.proxy_id) {
    const px = db.prepare('SELECT * FROM proxies WHERE id = ?').get(p.proxy_id) as ProxyRow | undefined;
    if (px) {
      proxy = {
        id: px.id,
        type: px.type,
        host: px.host,
        port: px.port,
        username: px.username,
        country: px.country,
        timezone: px.timezone,
        status: px.status,
      };
    }
  }

  let fingerprint: ProfileDetails['fingerprint'] = null;
  if (p.fingerprint_id) {
    const fp = db.prepare('SELECT seed, config_json FROM fingerprints WHERE id = ?').get(p.fingerprint_id) as { seed: number; config_json: string } | undefined;
    if (fp) {
      let cfg: Record<string, unknown> = {};
      try { cfg = JSON.parse(fp.config_json || '{}'); } catch { /* ignore */ }
      fingerprint = {
        seed: fp.seed,
        platform: typeof cfg.platform === 'string' ? cfg.platform : 'windows',
        hardwareConcurrency: typeof cfg.hardwareConcurrency === 'number' ? cfg.hardwareConcurrency : 8,
        brand: typeof cfg.brand === 'string' ? cfg.brand : 'Chrome',
      };
    }
  }

  let device: ProfileDetails['device'] = null;
  if (p.device_id) {
    const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(p.device_id) as { id: string; name: string; platform: string; config_json: string } | undefined;
    if (dev) {
      let cfg: Record<string, unknown> = {};
      try { cfg = JSON.parse(dev.config_json || '{}'); } catch { /* ignore */ }
      device = {
        id: dev.id,
        name: dev.name,
        platform: dev.platform,
        config: cfg,
      };
    }
  }

  return {
    user_id: p.id,
    name: p.name,
    status: p.status,
    group_id: p.group_id,
    device_id: p.device_id,
    browser_type: p.browser_type || 'chromium',
    user_agent: p.user_agent,
    timezone: p.timezone,
    proxy,
    fingerprint,
    device,
  };
}

export function deleteProfile(id: string): boolean {
  const db = getDb();
  const p = getProfile(id);
  if (!p) return false;
  if (p.fingerprint_id) {
    db.prepare('DELETE FROM fingerprints WHERE id = ?').run(p.fingerprint_id);
  }
  db.prepare('DELETE FROM profile_extensions WHERE profile_id = ?').run(id);
  const res = db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  return res.changes > 0;
}

export function setStatus(id: string, status: string): void {
  getDb()
    .prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id);
}

/**
 * Crash recovery: profiles stuck in "running" from a previous session (the app
 * crashed or was killed without a graceful shutdown) are marked "closed".
 * Returns the number of recovered rows.
 */
export function recoverStaleRunning(): number {
  const res = getDb()
    .prepare("UPDATE profiles SET status = 'closed', updated_at = ? WHERE status = 'running'")
    .run(Date.now());
  return res.changes;
}

export function updateProfile(
  id: string,
  updates: {
    name?: string;
    group_id?: string | null;
    proxy_id?: string | null;
    proxy?: ProxyInput | null;
    device_id?: string | null;
    user_agent?: string | null;
    timezone?: string | null;
    start_urls?: string[] | null;
    mobile_model_id?: string | null;
  }
): boolean {
  const db = getDb();
  const profile = getProfile(id);
  if (!profile) return false;

  let effectiveProxyId: string | null | undefined = updates.proxy_id;
  if (updates.proxy) {
    effectiveProxyId = 'x_' + randomUUID();
    db.prepare(
      `INSERT INTO proxies (id, type, host, port, username, password, private_key, country, timezone, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      effectiveProxyId,
      updates.proxy.type,
      updates.proxy.host,
      updates.proxy.port,
      updates.proxy.username ?? null,
      updates.proxy.password ?? null,
      updates.proxy.privateKey ?? null,
      null,
      null,
      'unknown',
      Date.now()
    );
  } else if (updates.proxy === null) {
    effectiveProxyId = null;
  }

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
  if (effectiveProxyId !== undefined) {
    sets.push('proxy_id = ?');
    params.push(effectiveProxyId);
  }
  if (updates.device_id !== undefined) {
    sets.push('device_id = ?');
    params.push(updates.device_id);
  }
  if (updates.user_agent !== undefined) {
    sets.push('user_agent = ?');
    params.push(updates.user_agent);
  }
  if (updates.timezone !== undefined) {
    sets.push('timezone = ?');
    params.push(updates.timezone);
  }
  if (updates.start_urls !== undefined) {
    sets.push('start_urls = ?');
    params.push(updates.start_urls && updates.start_urls.length ? JSON.stringify(updates.start_urls) : null);
  }
  if (updates.mobile_model_id !== undefined) {
    sets.push('mobile_model_id = ?');
    params.push(updates.mobile_model_id);
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
    where = ' WHERE p.group_id = ?';
    params.push(groupId);
  }

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM profiles p${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.status, p.group_id,
              px.type AS proxy_type, px.host AS proxy_host, px.port AS proxy_port, px.country AS proxy_country,
              fp.seed AS fingerprint_seed,
              dev.platform AS platform, dev.name AS device_name
       FROM profiles p
       LEFT JOIN proxies px ON px.id = p.proxy_id
       LEFT JOIN fingerprints fp ON fp.id = p.fingerprint_id
       LEFT JOIN devices dev ON dev.id = p.device_id
       ${where}
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Array<{
    id: string;
    name: string | null;
    status: string;
    group_id: string | null;
    proxy_type: string | null;
    proxy_host: string | null;
    proxy_port: number | null;
    proxy_country: string | null;
    fingerprint_seed: number | null;
    platform: string | null;
    device_name: string | null;
  }>;

  const list: ProfileListItem[] = rows.map((r) => ({
    user_id: r.id,
    name: r.name,
    status: r.status,
    group_id: r.group_id,
    proxy_type: r.proxy_type,
    proxy_host: r.proxy_host,
    proxy_port: r.proxy_port,
    proxy_country: r.proxy_country,
    fingerprint_seed: r.fingerprint_seed,
    platform: r.platform,
    device_name: r.device_name,
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
  let stealth: StealthConfig | undefined;
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

      // Stealth layer: Client Hints + headless-trace fixes, consistent with the device.
      const logicalPlatform =
        typeof devCfg.logicalPlatform === 'string'
          ? (devCfg.logicalPlatform as StealthConfig['logicalPlatform'])
          : devCfg.platform === 'macos'
            ? 'macos'
            : devCfg.platform === 'linux'
              ? 'linux'
              : devCfg.mobile === true
                ? (devCfg.platform as string) === 'ios'
                  ? 'ios'
                  : 'android'
                : 'windows';

      if (devCfg.mobile === true) {
        // Мобильный профиль v2: детерминированный «телефон» из пула по seed — только для Android.
        // Если пользователь зафиксировал модель (mobile_model_id) — используем её, иначе
        // детерминированный выбор от seed (один профиль = один телефон при каждом запуске).
        const isAndroid = logicalPlatform === 'android';
        const preset = isAndroid
          ? profile.mobile_model_id
            ? getMobilePreset(profile.mobile_model_id)
            : pickMobilePreset(fingerprintSeed)
          : undefined;
        deviceEmulation = {
          mobile: true,
          ua: preset ? buildMobileUa(preset) : typeof devCfg.ua === 'string' ? devCfg.ua : undefined,
          screen: preset ? preset.screen : (devCfg.screen as DeviceEmulationConfig['screen']),
          touch: typeof devCfg.touch === 'boolean' ? devCfg.touch : true,
          maxTouchPoints:
            typeof devCfg.maxTouchPoints === 'number' ? devCfg.maxTouchPoints : 5,
        };
        // Сохраняем пресет для stealth-слоя (модель/версия Android/GPU).
        if (preset) devCfg._preset = preset;
      }

      const preset = (devCfg._preset as MobilePreset | undefined) ?? undefined;
      stealth = {
        mobile: devCfg.mobile === true,
        logicalPlatform,
        ua: preset ? buildMobileUa(preset) : typeof devCfg.ua === 'string' ? devCfg.ua : undefined,
        model: preset ? preset.model : typeof devCfg.model === 'string' ? devCfg.model : undefined,
        platformVersion:
          preset
            ? `${preset.androidVersion}.0.0`
            : typeof devCfg.platformVersion === 'string'
              ? devCfg.platformVersion
              : undefined,
        hardwareConcurrency:
          preset
            ? preset.hardwareConcurrency
            : typeof devCfg.hardwareConcurrency === 'number'
              ? devCfg.hardwareConcurrency
              : undefined,
        deviceMemory: typeof devCfg.deviceMemory === 'number' ? devCfg.deviceMemory : undefined,
        maxTouchPoints:
          typeof devCfg.maxTouchPoints === 'number' ? devCfg.maxTouchPoints : undefined,
      };

      if (fingerprint) {
        if (typeof devCfg.platform === 'string') {
          fingerprint.platform = devCfg.platform;
        }
        if (typeof devCfg.platformVersion === 'string') {
          fingerprint.platformVersion = devCfg.platformVersion;
        }
        if (typeof devCfg.brand === 'string') fingerprint.brand = devCfg.brand;
        if (typeof devCfg.hardwareConcurrency === 'number') {
          fingerprint.hardwareConcurrency = devCfg.hardwareConcurrency;
        }
        if (typeof devCfg.lang === 'string') fingerprint.lang = devCfg.lang;
        if (typeof devCfg.timezone === 'string') fingerprint.timezone = devCfg.timezone;
      }
    }
  }

  // Stealth layer applies to every profile (headless-trace fixes are universal);
  // device presets above refine it for mobile/desktop consistency.
  if (!stealth) {
    stealth = {
      mobile: false,
      logicalPlatform: 'windows',
      hardwareConcurrency:
        typeof fingerprint?.hardwareConcurrency === 'number'
          ? fingerprint.hardwareConcurrency
          : undefined,
    };
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
        proxyServer = `${px.type}://${px.host}:${px.port}`;
        if (px.username && px.password) {
          proxyAuth = { username: px.username, password: px.password };
        }
      }
    }
  }

  // Geolocation override (Sprint A)
  let geolocation: LaunchConfig['geolocation'];
  if (profile.geolocation) {
    try {
      const g = JSON.parse(profile.geolocation) as { latitude?: number; longitude?: number; accuracy?: number };
      if (typeof g.latitude === 'number' && typeof g.longitude === 'number') {
        geolocation = { latitude: g.latitude, longitude: g.longitude, accuracy: g.accuracy };
      }
    } catch {
      // ignore
    }
  } else if (profile.proxy_id) {
    const px = db.prepare('SELECT latitude, longitude FROM proxies WHERE id = ?').get(profile.proxy_id) as
      | { latitude: number | null; longitude: number | null }
      | undefined;
    if (px && typeof px.latitude === 'number' && typeof px.longitude === 'number') {
      geolocation = { latitude: px.latitude, longitude: px.longitude };
    }
  }

  // Cookies (Sprint A)
  let cookies: Array<Record<string, unknown>> | undefined;
  const cookieRow = db
    .prepare('SELECT cookies_json FROM profiles WHERE id = ?')
    .get(id) as { cookies_json: string | null } | undefined;
  if (cookieRow?.cookies_json) {
    try {
      const parsed = JSON.parse(cookieRow.cookies_json);
      if (Array.isArray(parsed)) cookies = parsed;
    } catch {
      // ignore malformed json
    }
  }

  // Extensions (Sprint B): on-disk paths of bound extensions.
  const extPaths = getEnabledExtensionPaths(id);

  // Start URLs (v0.2.6): opened on start (first in current tab, rest in new tabs).
  let startUrls: string[] | undefined;
  const startUrlsRow = db
    .prepare('SELECT start_urls FROM profiles WHERE id = ?')
    .get(id) as { start_urls: string | null } | undefined;
  if (startUrlsRow?.start_urls) {
    try {
      const parsed = JSON.parse(startUrlsRow.start_urls);
      if (Array.isArray(parsed)) startUrls = parsed.filter((u) => typeof u === 'string');
    } catch {
      // ignore malformed json
    }
  }

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
    stealth,
    geolocation,
    cookies,
    extensionPaths: extPaths.length ? extPaths : undefined,
    startUrls: startUrls && startUrls.length ? startUrls : undefined,
    userAgent: profile.user_agent ?? undefined,
    timezone: profile.timezone ?? undefined,
  };
}
