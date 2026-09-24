// License manager (Sprint 1): Free/Pro feature gating with offline Ed25519
// validation.
//
// Key format: "<base64url-payload>.<base64url-signature>"
//   payload    — JSON {plan:"pro", exp?:<unix-seconds>, email?:string}
//   signature  — Ed25519 over the exact payload bytes (PKCS8/SPKI PEM keys)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, sign, verify } from 'node:crypto';
import { getSetting, setSetting, isPortableMode, portableBaseDir } from '../config';
import { protectSecret, revealSecret } from '../util/secretStore';
import { LICENSE_PUBLIC_KEY_PEM } from './publicKey';
export type LicensePlan = 'free' | 'pro';

export interface LicensePayload {
  plan: LicensePlan;
  /** Unix seconds; absent = never expires. */
  exp?: number;
  email?: string;
  /** Vendor-issued key id for rotation bookkeeping. */
  kid?: string;
}

export interface LicenseState {
  plan: LicensePlan;
  email?: string;
  exp?: number;
  expired: boolean;
}

export type LicenseFeature = 'teams' | 'sync';

const LICENSE_STORE_KEY = 'licenseKey';

export type LicenseValidationResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: 'INVALID_LICENSE' | 'LICENSE_EXPIRED' };

/** base64url helpers (no padding, URL-safe alphabet). */
function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(norm, 'base64');
}

/** Sign a payload with a PKCS8 private key PEM (vendor/dev tooling). */
export function signLicensePayload(payload: LicensePayload, privateKeyPem: string): string {
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = sign(null, payloadBuf, privateKeyPem) as Buffer;
  return `${b64urlEncode(payloadBuf)}.${b64urlEncode(signature)}`;
}

/**
 * Fingerprint of the pinned key, computed over its BASE64 BODY rather than the file bytes.
 *
 * Hashing the raw file made the value depend on the checkout's line endings: the PEM is stored
 * with LF, and `core.autocrlf=true` (the Git-for-Windows default) rewrites it to CRLF on checkout.
 * Rust bakes the bytes in with `include_str!` at COMPILE time while this constant is generated
 * from the WORKING TREE, so the two sides hashed different bytes and every valid licence was
 * refused. The base64 body IS the key material and carries no line endings, so both agree.
 *
 * Kept in lockstep with `normalize_pem_body` in `src-tauri/src/license.rs`.
 */
export function getPinnedKeyFingerprint(): string {
  const keyBody = LICENSE_PUBLIC_KEY_PEM.split('\n')
    .filter((line) => !line.trimStart().startsWith('-----'))
    .map((line) => line.trim())
    .join('');
  return createHash('sha256').update(keyBody, 'utf8').digest('hex').slice(0, 16);
}

/** Locate settings directory where settings.json (and license-verdict.json) live. */
function getSettingsDir(): string {
  if (process.env.ANTIDETECT_SETTINGS_DIR && process.env.ANTIDETECT_SETTINGS_DIR.length > 0) {
    return process.env.ANTIDETECT_SETTINGS_DIR;
  }
  if (isPortableMode()) {
    const p = portableBaseDir();
    if (p) return p;
  }
  return path.join(os.homedir(), '.antidetect');
}

/** Validate a license key offline. Signature must verify against the pinned key (or provided key). */
export function validateLicenseKey(key: string, publicKeyPem?: string): LicenseValidationResult {
  const trimmed = String(key ?? '').trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) return { ok: false, reason: 'INVALID_LICENSE' };
  const payloadPart = trimmed.slice(0, dot);
  const sigPart = trimmed.slice(dot + 1);

  let payloadBuf: Buffer;
  let sigBuf: Buffer;
  try {
    payloadBuf = b64urlDecode(payloadPart);
    sigBuf = b64urlDecode(sigPart);
  } catch {
    return { ok: false, reason: 'INVALID_LICENSE' };
  }
  if (sigBuf.length !== 64) return { ok: false, reason: 'INVALID_LICENSE' };

  let verified = false;
  const keyToUse = publicKeyPem ?? LICENSE_PUBLIC_KEY_PEM;
  try {
    verified = verify(null, payloadBuf, keyToUse, sigBuf);
  } catch {
    verified = false;
  }
  if (!verified) return { ok: false, reason: 'INVALID_LICENSE' };

  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBuf.toString('utf8')) as LicensePayload;
  } catch {
    return { ok: false, reason: 'INVALID_LICENSE' };
  }
  if (!payload || payload.plan !== 'pro') return { ok: false, reason: 'INVALID_LICENSE' };
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: 'LICENSE_EXPIRED' };
  }
  return { ok: true, payload };
}

/** Activate a license key. Returns the validation error string on failure. */
export function activateLicense(key: string): { ok: boolean; error?: string; state?: LicenseState } {
  if (process.env.ENABLE_LICENSING !== '1') {
    return { ok: true, state: getLicenseState() };
  }
  const res = validateLicenseKey(key);
  if (!res.ok) return { ok: false, error: res.reason };
  setSetting(LICENSE_STORE_KEY, protectSecret(key) ?? '');
  return { ok: true, state: getLicenseState() };
}

/** Remove the stored license (downgrade to Free). */
export function deactivateLicense(): void {
  setSetting(LICENSE_STORE_KEY, '');
}

/** Current license state (revalidates the stored key; no network involved). */
export function getLicenseState(): LicenseState {
  // ponytail: license gating disabled; all features available to everyone.
  // Set ENABLE_LICENSING=1 to enforce offline Ed25519 validation.
  if (process.env.ENABLE_LICENSING !== '1') {
    return { plan: 'pro', expired: false };
  }
  const stored = revealSecret(String(getSetting(LICENSE_STORE_KEY) ?? ''));
  if (!stored) return { plan: 'free', expired: false };
  const res = validateLicenseKey(stored);
  if (!res.ok) {
    // Tampered/expired stored key falls back to Free but stays removable.
    return { plan: 'free', expired: res.reason === 'LICENSE_EXPIRED' };
  }

  // Cross-check ONLY when running inside packaged build (ANTIDETECT_PACKAGED === '1').
  // Outside packaged builds (tests, CI, npm run service), pure Ed25519 is authoritative.
  if (process.env.ANTIDETECT_PACKAGED === '1') {
    const verdictPath = path.join(getSettingsDir(), 'license-verdict.json');
    try {
      if (!fs.existsSync(verdictPath)) {
        return { plan: 'free', expired: false, email: res.payload.email, exp: res.payload.exp };
      }
      const raw = fs.readFileSync(verdictPath, 'utf8');
      const verdict = JSON.parse(raw);
      const tokenFp = createHash('sha256').update(stored, 'utf8').digest('hex').slice(0, 16);
      const isVerdictValid =
        verdict &&
        verdict.schema === 1 &&
        verdict.valid === true &&
        verdict.key_fp === getPinnedKeyFingerprint() &&
        verdict.token_fp === tokenFp;

      if (!isVerdictValid) {
        return { plan: 'free', expired: false, email: res.payload.email, exp: res.payload.exp };
      }
    } catch {
      // Missing, unreadable, or invalid JSON verdict file falls back to Free (never throws).
      return { plan: 'free', expired: false, email: res.payload.email, exp: res.payload.exp };
    }
  }

  return {
    plan: 'pro',
    email: res.payload.email,
    exp: res.payload.exp,
    expired: false,
  };
}

/** True when the given Pro feature is unlocked by the current license. */
export function hasFeature(feature: LicenseFeature): boolean {
  if (process.env.ENABLE_LICENSING !== '1') return true;
  if (getLicenseState().plan !== 'pro') return false;
  void feature; // every Pro feature is unlocked in Sprint 1
  return true;
}

/** True when the current license is Pro. */
export function isPro(): boolean {
  if (process.env.ENABLE_LICENSING !== '1') return true;
  return getLicenseState().plan === 'pro';
}