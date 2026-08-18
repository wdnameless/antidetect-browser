// Device presets: named device configurations (desktop OS / mobile) applied to profiles.
import { randomUUID } from 'crypto';
import { getDb } from '../db';

export type DevicePlatform = 'win' | 'mac' | 'linux' | 'ios' | 'android';

export interface DeviceScreen {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface DeviceConfig {
  /** Kernel --fingerprint-platform (desktop OS spoofing). */
  platform: 'windows' | 'linux' | 'macos';
  /** Logical platform for the stealth layer (Client Hints, navigator.platform, sensors). */
  logicalPlatform?: 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  platformVersion?: string;
  brand?: string;
  hardwareConcurrency?: number;
  lang?: string;
  timezone?: string;
  /** Mobile presets are emulated at the CDP layer (kernel has no mobile platform). */
  mobile?: boolean;
  ua?: string;
  model?: string;
  screen?: DeviceScreen;
  touch?: boolean;
  maxTouchPoints?: number;
}

export interface DeviceRow {
  id: string;
  name: string;
  platform: DevicePlatform;
  config_json: string;
}

export interface DeviceInput {
  name: string;
  platform: DevicePlatform;
  config: DeviceConfig;
}

export function getDevice(id: string): DeviceRow | undefined {
  return getDb().prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
}

export function getDeviceConfig(id: string): DeviceConfig | undefined {
  const row = getDevice(id);
  if (!row) return undefined;
  try {
    return JSON.parse(row.config_json) as DeviceConfig;
  } catch {
    return undefined;
  }
}

export function listDevices(): DeviceRow[] {
  return getDb().prepare('SELECT * FROM devices ORDER BY name').all() as DeviceRow[];
}

export function createDevice(input: DeviceInput): string {
  const db = getDb();
  const id = 'dev_' + randomUUID();
  db.prepare('INSERT INTO devices (id, name, platform, config_json) VALUES (?, ?, ?, ?)').run(
    id,
    input.name,
    input.platform,
    JSON.stringify(input.config)
  );
  return id;
}

export function updateDevice(id: string, input: Partial<DeviceInput>): boolean {
  const db = getDb();
  const existing = getDevice(id);
  if (!existing) return false;
  db.prepare('UPDATE devices SET name = ?, platform = ?, config_json = ? WHERE id = ?').run(
    input.name ?? existing.name,
    input.platform ?? existing.platform,
    input.config ? JSON.stringify(input.config) : existing.config_json,
    id
  );
  return true;
}

export function deleteDevice(id: string): boolean {
  const db = getDb();
  const used = db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE device_id = ?').get(id) as { c: number };
  if (used.c > 0) throw new Error('device is assigned to a profile');
  return db.prepare('DELETE FROM devices WHERE id = ?').run(id).changes > 0;
}

/** Seed built-in device presets (idempotent). */
export function seedDevices(): void {
  const db = getDb();
  const presets: Array<{ id: string; name: string; platform: DevicePlatform; config: DeviceConfig }> = [
    {
      id: 'dev_win10',
      name: 'Windows 10',
      platform: 'win',
      config: {
        platform: 'windows',
        platformVersion: '10.0.19045',
        brand: 'Chrome',
        hardwareConcurrency: 8,
        lang: 'en-US',
      },
    },
    {
      id: 'dev_win11',
      name: 'Windows 11',
      platform: 'win',
      config: {
        platform: 'windows',
        platformVersion: '10.0.22631',
        brand: 'Chrome',
        hardwareConcurrency: 12,
        lang: 'en-US',
      },
    },
    {
      id: 'dev_macos',
      name: 'macOS',
      platform: 'mac',
      config: {
        platform: 'macos',
        platformVersion: '15.2.0',
        brand: 'Chrome',
        hardwareConcurrency: 8,
        lang: 'en-US',
      },
    },
    {
      id: 'dev_android',
      name: 'Android (Pixel 8)',
      platform: 'android',
      config: {
        platform: 'windows',
        logicalPlatform: 'android',
        mobile: true,
        ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
        model: 'Pixel 8',
        screen: { width: 412, height: 915, deviceScaleFactor: 2.625 },
        touch: true,
        maxTouchPoints: 5,
      },
    },
    {
      id: 'dev_iphone',
      name: 'iPhone 15',
      platform: 'ios',
      config: {
        platform: 'windows',
        logicalPlatform: 'ios',
        mobile: true,
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        model: 'iPhone',
        screen: { width: 393, height: 852, deviceScaleFactor: 3 },
        touch: true,
        maxTouchPoints: 5,
      },
    },
  ];
  const insert = db.prepare(
    'INSERT INTO devices (id, name, platform, config_json) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET name = excluded.name, platform = excluded.platform, config_json = excluded.config_json'
  );
  for (const p of presets) {
    insert.run(p.id, p.name, p.platform, JSON.stringify(p.config));
  }
}
