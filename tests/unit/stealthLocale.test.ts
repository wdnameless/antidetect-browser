// The browser's language and the stealth layer's locale must agree.
//
// `fingerprint.lang` is what the launcher turns into `--lang` and `--accept-lang`, so
// `navigator.language` follows it. The stealth layer carries its own `locale`, used for the
// speech-synthesis voice pool and the font list, and it was ALWAYS taken from the fingerprint's
// seed-derived locale — so a profile whose operator picked en-US still advertised voices and
// fonts for whatever language the seed happened to produce. A page reading both sees a machine
// that claims one language and speaks another, which is the inconsistency this layer exists to
// prevent.
//
// These tests resolve a real launch config from a real (in-memory) database, because the defect
// is in how the two values are assembled.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDb, closeDb, getDb } from '../../src/main/db';
import { createProfile, resolveLaunchConfig } from '../../src/main/profiles/profileManager';
import { stealthLocaleChanged } from '../../src/main/launcher/chromium';

describe('the chosen browser language reaches the stealth layer', () => {
  beforeEach(async () => {
    await initDb(':memory:');
  });

  afterEach(() => {
    closeDb();
  });

  /** Write a language into the profile's fingerprint config, as the UI does. */
  function setLanguage(userId: string, lang: string): void {
    const db = getDb();
    const row = db.prepare('SELECT fingerprint_id FROM profiles WHERE id = ?').get(userId) as {
      fingerprint_id: string;
    };
    const fp = db.prepare('SELECT config_json FROM fingerprints WHERE id = ?').get(row.fingerprint_id) as {
      config_json: string;
    };
    const cfg = JSON.parse(fp.config_json || '{}') as Record<string, unknown>;
    cfg.lang = lang;
    db.prepare('UPDATE fingerprints SET config_json = ? WHERE id = ?').run(JSON.stringify(cfg), row.fingerprint_id);
  }

  it('uses the chosen language for both the browser and the stealth locale', () => {
    const id = createProfile({ name: 'Lang Sync' });
    setLanguage(id, 'en-US');

    const cfg = resolveLaunchConfig(id);

    expect(cfg.fingerprint.lang).toBe('en-US');
    // The stealth locale must follow, or the voice pool and font list disagree with the browser.
    expect(cfg.stealth?.locale).toBe('en-US');
  });

  it('follows the language even when it differs from the seed-derived locale', () => {
    // A seed-derived locale is one of a handful of values; pick the language by choosing a
    // profile whose config we then overwrite, which is exactly what the UI does.
    const id = createProfile({ name: 'Lang Override' });
    const before = resolveLaunchConfig(id).stealth?.locale;
    setLanguage(id, 'de-DE');
    const after = resolveLaunchConfig(id);

    expect(after.fingerprint.lang).toBe('de-DE');
    expect(after.stealth?.locale).toBe('de-DE');
    // Guards against the test passing by accident: the seed-derived value must have been
    // something else, or this case proves nothing about overriding it.
    expect(before, 'pick a seed whose locale differs from de-DE for this case to be meaningful').not.toBe('de-DE');
  });

  it('leaves the seed-derived locale alone when no language is chosen', () => {
    // "Auto" means the fingerprint decides. An empty value must not become an empty locale.
    const id = createProfile({ name: 'Lang Auto' });
    setLanguage(id, '');

    const cfg = resolveLaunchConfig(id);

    expect(cfg.stealth?.locale, 'Auto must still resolve to a real locale').toBeTruthy();
    expect(cfg.stealth?.locale).not.toBe('');
  });
});

// The stealth extension is written once and, before this check existed, never rewritten — so a
// language chosen after the first launch left the old locale embedded in it. Measured on a real
// profile: `navigator.language` reported en-US while the generated voice pool still said `ja-JP`.
// Two halves of one profile disagreeing about the language is exactly what this layer prevents.
describe('a changed language rebuilds the stealth extension', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nulltrace-stealth-locale-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeScript = (locale: string): void => {
    fs.writeFileSync(
      path.join(dir, 'stealth.js'),
      `(() => {\n  const CFG = ${JSON.stringify({ mobile: false, locale })};\n  return CFG;\n})();`,
      'utf8',
    );
  };

  it('detects that the embedded locale differs from the profile language', () => {
    writeScript('ja-JP');
    expect(stealthLocaleChanged(dir, { locale: 'en-US' })).toBe(true);
  });

  it('leaves the extension alone when the locale already matches', () => {
    writeScript('en-US');
    expect(stealthLocaleChanged(dir, { locale: 'en-US' })).toBe(false);
  });

  it('rebuilds a missing or unreadable script rather than trusting it', () => {
    expect(stealthLocaleChanged(dir, { locale: 'en-US' }), 'missing file').toBe(true);
    fs.writeFileSync(path.join(dir, 'stealth.js'), 'not the shape we expect', 'utf8');
    expect(stealthLocaleChanged(dir, { locale: 'en-US' }), 'unparseable file').toBe(true);
  });
});
