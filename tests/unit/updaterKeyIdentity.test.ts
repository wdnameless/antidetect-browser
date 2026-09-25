// Guards the update chain's identity and its compatibility with already-installed builds.
//
// Written after a real incident: the updater signing key was regenerated to work around a password
// problem that turned out not to exist (a stale doc claimed the password was wrong, while CI had in
// fact been signing successfully — v0.6.42's signature verifies against the key it shipped). The
// rotation was therefore unnecessary AND breaking: every installed build embeds the previous public
// key and rejects anything signed by a different one at DOWNLOAD time, so those installs cannot
// update themselves. Nothing in the build failed; the mistake was only visible by verifying an
// actual published artifact against the key an actual installed build carries.
//
// These checks make the next occurrence loud.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

/** The minisign key id embedded in a Tauri updater pubkey blob. */
function keyIdOf(pubkeyB64: string): string {
  const blob = Buffer.from(pubkeyB64, 'base64').toString('utf8');
  const m = blob.match(/public key:\s*([0-9A-F]{16})/i);
  if (!m) throw new Error('pubkey blob has no minisign key id');
  return m[1].toUpperCase();
}

function shippingKeyId(): string {
  const conf: unknown = JSON.parse(read('src-tauri/tauri.conf.json'));
  if (!conf || typeof conf !== 'object') throw new Error('tauri.conf.json is not an object');
  const plugins = (conf as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== 'object') throw new Error('tauri.conf.json has no plugins');
  const updater = (plugins as { updater?: unknown }).updater;
  if (!updater || typeof updater !== 'object') throw new Error('no updater config');
  const pubkey = (updater as { pubkey?: unknown }).pubkey;
  if (typeof pubkey !== 'string' || pubkey.length === 0) throw new Error('no updater pubkey');
  return keyIdOf(pubkey);
}

describe('the updater signing identity', () => {
  const identity: unknown = JSON.parse(read('resources/release-key-identity.json'));

  it('matches the key recorded as shipping, so a swap cannot happen silently', () => {
    // Regenerating the key is sometimes necessary, but it MUST be a recorded decision: an
    // unrecorded swap silently strands every installed build, and no build step fails.
    const recorded = (identity as { active?: { keyId?: unknown } }).active?.keyId;
    expect(typeof recorded, 'release-key-identity.json must name the active key id').toBe('string');
    expect(
      shippingKeyId(),
      'the pubkey in tauri.conf.json no longer matches the recorded shipping key. If this rotation ' +
        'is intentional, update resources/release-key-identity.json (recording the previous id under ' +
        '"retired") and note the compatibility consequence in the changelog: installed builds embed ' +
        'the OLD key and will reject new releases at download time.',
    ).toBe(String(recorded).toUpperCase());
  });

  it('keeps the retired key on record, so old signatures remain attributable', () => {
    // Without this, nobody can tell whether a published signature came from a key we still control
    // or from one nobody can identify.
    const retired = (identity as { retired?: Array<{ keyId?: unknown }> }).retired;
    expect(Array.isArray(retired) && retired.length > 0).toBe(true);
    const ids = (retired ?? []).map((r) => String(r.keyId).toUpperCase());
    expect(ids).toContain('29F423F8EFA4DD7F');
  });

  it('never ships the private key', () => {
    // The public half is in the config by design; the private half must never be in the tree.
    const tracked = ['src-tauri/tauri.conf.json', 'resources/release-key-identity.json'];
    for (const rel of tracked) {
      const body = read(rel);
      expect(/BEGIN (RSA |OPENSSH |PRIVATE)/.test(body), `${rel} contains private key material`).toBe(false);
      expect(body.includes('rsign encrypted secret key'), `${rel} contains a private minisign key`).toBe(false);
    }
  });
});
