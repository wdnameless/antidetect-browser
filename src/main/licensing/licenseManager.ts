// License manager (Sprint 1): Free/Pro feature gating with offline Ed25519
// validation.
//
// Key format: "<base64url-payload>.<base64url-signature>"
//   payload    — JSON {plan:"pro", exp?:<unix-seconds>, email?:string}
//   signature  — Ed25519 over the exact payload bytes (PKCS8/SPKI PEM keys)
// The public key is embedded in the build (publicKey.ts); the private key is
// held by the vendor only (see .env.example: LICENSE_PRIVATE_KEY).

import { sign, verify } from 'crypto';
import { getSetting, setSetting } from '../config';
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

/** Validate a license key offline. Signature must verify against the pinned key. */
export function validateLicenseKey(key: string): LicenseValidationResult {
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
  try {
    verified = verify(null, payloadBuf, LICENSE_PUBLIC_KEY_PEM, sigBuf);
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
  const stored = revealSecret(String(getSetting(LICENSE_STORE_KEY) ?? ''));
  if (!stored) return { plan: 'free', expired: false };
  const res = validateLicenseKey(stored);
  if (!res.ok) {
    // Tampered/expired stored key falls back to Free but stays removable.
    return { plan: 'free', expired: res.reason === 'LICENSE_EXPIRED' };
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
  if (getLicenseState().plan !== 'pro') return false;
  void feature; // every Pro feature is unlocked in Sprint 1
  return true;
}

/** True when the current license is Pro. */
export function isPro(): boolean {
  return getLicenseState().plan === 'pro';
}