// A form field that never reaches the save path looks implemented and does nothing.
//
// The reported defect: the Edit Profile modal offers a "Browser language" select, but saving a
// profile never sent that value anywhere. `profileLang` was read from the fingerprint and
// rendered into the select, so the control displayed a real value and appeared to work — while
// `profileUpdate` carried name, group, proxy, colour, timezone, DNT, blocked ports and WebRTC,
// and simply omitted the language. The operator changed it, pressed Save, saw success, and the
// value was gone the next time the modal opened.
//
// The language is worth more than most fields: the launcher turns it into `--lang` and
// `--accept-lang`, and the stealth layer reports it as `navigator.language`, so a silently
// dropped language changes what websites see.
//
// This checks the general rule the defect broke: for every value the modal collects, the save
// path must actually use it. It reads the component's source because that is where the omission
// lives — no rendered test would catch a field that is displayed from state and then not sent.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PROFILES_TSX = path.resolve(__dirname, '../../src/renderer/src/pages/Profiles.tsx');

/** The body of the modal's save handler, from its declaration to the start of the next function. */
function saveHandlerBody(source: string): string {
  const start = source.indexOf('const saveProfileModal');
  expect(start, 'saveProfileModal handler not found — this test needs updating').toBeGreaterThan(-1);
  const nextFn = source.indexOf('\n  const ', start + 10);
  return source.slice(start, nextFn === -1 ? source.length : nextFn);
}

describe('profile save reaches every field the modal collects', () => {
  const source = fs.readFileSync(PROFILES_TSX, 'utf8');

  it('persists the browser language chosen in the modal', () => {
    const body = saveHandlerBody(source);

    // The value must be USED by the save path, in either mode. `saveProfileLanguage` is the
    // helper that writes it through the fingerprint route, because `lang` is not a column on
    // `profiles` and `profileUpdate` does not accept it.
    expect(
      /saveProfileLanguage\s*\(/.test(body),
      'the save handler never persists `profileLang`. The modal shows a Browser language select ' +
        'whose value is discarded on Save — set the language through the fingerprint route, ' +
        'where the launcher reads it from.',
    ).toBe(true);
  });

  it('persists it in BOTH create and edit, not just one', () => {
    const body = saveHandlerBody(source);
    // Two branches, two saves: a fix applied to one mode only would still lose the value in the
    // other, and the modal offers the same control in both.
    const uses = body.match(/saveProfileLanguage\s*\(/g) ?? [];
    expect(
      uses.length,
      `the language is saved in ${uses.length} of the two branches (create, edit)`,
    ).toBeGreaterThanOrEqual(2);
  });

  it('writes it through the fingerprint route, where the launcher reads it', () => {
    // `profileUpdate` has no language field; the value lives at `fingerprint.config.lang`.
    const helperStart = source.indexOf('const saveProfileLanguage');
    expect(helperStart, 'saveProfileLanguage helper not found').toBeGreaterThan(-1);
    const nextFn = source.indexOf('\n  const ', helperStart + 10);
    const helper = source.slice(helperStart, nextFn === -1 ? source.length : nextFn);
    expect(
      /profileUpdateFingerprint/.test(helper),
      'the language must be written with profileUpdateFingerprint — that is the route that ' +
        'stores it, and the only one the launcher reads back',
    ).toBe(true);
  });

  it('keeps "Auto" distinguishable from a concrete language', () => {
    // The select renders Auto with an empty value. A default (or reset) of 'en-US' would make
    // the dropdown display Auto while the state held en-US, so the form would disagree with
    // itself and the operator could not choose Auto at all without touching the control twice.
    const defaults = source.match(/setProfileLang\(\s*'([^']*)'\s*\)/g) ?? [];
    const nonEmpty = defaults.filter((d) => !/setProfileLang\(\s*''\s*\)/.test(d));
    expect(
      nonEmpty,
      `these set the language to a concrete value where Auto is meant: ${nonEmpty.join(', ')}`,
    ).toEqual([]);
  });
});
