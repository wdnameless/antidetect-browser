// Sprint-1 DEV license keypair — the private key below is for LOCAL
// DEVELOPMENT ONLY and must be rotated before public release.
import { describe, it, expect } from 'vitest';
import {
  validateLicenseKey,
  activateLicense,
  deactivateLicense,
  getLicenseState,
  isPro,
  hasFeature,
  signLicensePayload,
} from '../../src/main/licensing/licenseManager';
import { LICENSE_PUBLIC_KEY_PEM } from '../../src/main/licensing/publicKey';

// Dev private key matching the pinned public key in publicKey.ts.
const DEV_PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MC4CAQAwBQYDK2VwBCIEIBipPHWGZ3OzH1FI3h/itES5zpxBhW1x5jB1N9mjRC+m',
  '-----END PRIVATE KEY-----',
].join('\n');

describe('licenseManager: Ed25519 offline validation', () => {
  it('accepts a validly-signed Pro key', () => {
    const key = signLicensePayload({ plan: 'pro', email: 'dev@example.com' }, DEV_PRIVATE_KEY);
    const res = validateLicenseKey(key);
    expect(res.ok).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const key = signLicensePayload({ plan: 'pro', email: 'a@example.com' }, DEV_PRIVATE_KEY);
    const dot = key.lastIndexOf('.');
    // flip the email inside the payload, keep the original signature
    const payloadPart = key.slice(0, dot);
    const sigPart = key.slice(dot + 1);
    const norm = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const obj = JSON.parse(Buffer.from(norm, 'base64').toString('utf8')) as { email?: string };
    obj.email = 'evil@example.com';
    const tamperedPayload = Buffer.from(JSON.stringify(obj), 'utf8');
    const tamperedB64 = tamperedPayload.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = validateLicenseKey(`${tamperedB64}.${sigPart}`);
    expect(res.ok).toBe(false);
  });

  it('rejects a signature from a foreign key', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { generateKeyPairSync } = require('crypto') as typeof import('crypto');
    const foreign = generateKeyPairSync('ed25519');
    const foreignPriv = foreign.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const key = signLicensePayload({ plan: 'pro' }, foreignPriv);
    const res = validateLicenseKey(key);
    expect(res.ok).toBe(false);
  });

  it('rejects malformed keys', () => {
    expect(validateLicenseKey('').ok).toBe(false);
    expect(validateLicenseKey('nodot').ok).toBe(false);
    expect(validateLicenseKey('aaa.bbb').ok).toBe(false);
    expect(validateLicenseKey('only.').ok).toBe(false);
  });

  it('rejects a non-pro plan payload', () => {
    const key = signLicensePayload({ plan: 'free' }, DEV_PRIVATE_KEY);
    expect(validateLicenseKey(key).ok).toBe(false);
  });

  it('rejects an expired key with LICENSE_EXPIRED', () => {
    const key = signLicensePayload({ plan: 'pro', exp: Math.floor(Date.now() / 1000) - 3600 }, DEV_PRIVATE_KEY);
    const res = validateLicenseKey(key);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('LICENSE_EXPIRED');
  });

  it('activate/getLicenseState roundtrip through the settings store', () => {
    const key = signLicensePayload({ plan: 'pro', email: 'roundtrip@example.com' }, DEV_PRIVATE_KEY);
    const act = activateLicense(key);
    expect(act.ok).toBe(true);
    const state = getLicenseState();
    expect(state.plan).toBe('pro');
    expect(state.email).toBe('roundtrip@example.com');
    expect(isPro()).toBe(true);
    expect(hasFeature('teams')).toBe(true);
    expect(hasFeature('sync')).toBe(true);

    deactivateLicense();
    expect(getLicenseState().plan).toBe('free');
    expect(isPro()).toBe(false);
    expect(hasFeature('teams')).toBe(false);
    expect(hasFeature('sync')).toBe(false);
  });

  it('activation rejects invalid keys and stays Free', () => {
    const r = activateLicense('garbage.key');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('INVALID_LICENSE');
    expect(getLicenseState().plan).toBe('free');
  });

  it('pinned public key is a valid PEM', () => {
    expect(LICENSE_PUBLIC_KEY_PEM).toContain('BEGIN PUBLIC KEY');
    expect(signLicensePayload({ plan: 'pro' }, DEV_PRIVATE_KEY).split('.').length).toBe(2);
  });
});