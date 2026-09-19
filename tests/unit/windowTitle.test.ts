import { describe, it, expect } from 'vitest';
import {
  composeWindowTitle,
  isAsciiOnly,
  asciiWindowName,
  planWindowTitle,
} from '../../src/main/launcher/windowTitle';

/**
 * The title an OS window advertises, which is what the taskbar shows on hover.
 *
 * The behaviour encoded here was measured against the shipped kernel
 * (`fingerprint-chromium 148.0.7778.215`), because the two mechanisms are not
 * interchangeable and getting it wrong is silent:
 *
 *   - `--window-name` pins the title in the kernel and survives pages rewriting
 *     theirs, but a value containing ANY non-ASCII character is dropped entirely —
 *     the window falls back to "<page> - Chromium" with no error.
 *   - `SetWindowTextW` accepts any Unicode, but a page that sets `document.title`
 *     overwrites it, so it has to be re-applied.
 *
 * They must never run together: with the flag set the kernel re-asserts its value
 * and reverts a WinAPI write. `planWindowTitle` is the single place that chooses.
 */
describe('profile window title', () => {
  describe('composeWindowTitle', () => {
    it('uses the profile name', () => {
      expect(composeWindowTitle('kz-01')).toBe('kz-01');
    });

    it('puts the badge prefix in front, the way the parity feature always claimed to', () => {
      // The old implementation prepended this through a CDP command that does not exist,
      // so no window ever showed a badge.
      expect(composeWindowTitle('kz-01', '[KZ] ')).toBe('[KZ] kz-01');
    });

    it('collapses whitespace and trims, because a newline makes a taskbar tooltip unreadable', () => {
      expect(composeWindowTitle('  inst\n a  ')).toBe('inst a');
    });

    it('keeps the name alone when there is no colour badge', () => {
      expect(composeWindowTitle('kz-01', '')).toBe('kz-01');
    });

    it('returns the badge alone when the profile has no name', () => {
      expect(composeWindowTitle(null, '[P] ')).toBe('[P]');
      expect(composeWindowTitle('', '[P] ')).toBe('[P]');
    });

    it('returns empty when there is neither', () => {
      expect(composeWindowTitle(null)).toBe('');
      expect(composeWindowTitle('   ')).toBe('');
    });

    it('bounds the title so a pasted essay cannot fill the taskbar', () => {
      expect(composeWindowTitle('x'.repeat(300)).length).toBe(96);
    });
  });

  describe('isAsciiOnly', () => {
    it('accepts plain ASCII', () => {
      expect(isAsciiOnly('kz-01 NullTrace')).toBe(true);
    });

    it('rejects Cyrillic and accented Latin, which the kernel flag silently drops', () => {
      expect(isAsciiOnly('Профиль 1')).toBe(false);
      expect(isAsciiOnly('café')).toBe(false);
    });
  });

  describe('asciiWindowName', () => {
    it('passes an ASCII title through', () => {
      expect(asciiWindowName('kz-01 NullTrace')).toBe('kz-01 NullTrace');
    });

    it('refuses a non-ASCII title instead of mangling it', () => {
      // Returning "1" for "Профиль 1" would look like it worked while showing a name the
      // operator never chose; the caller must switch mechanism instead.
      expect(asciiWindowName('Профиль 1')).toBeNull();
      expect(asciiWindowName('kz-01 Профиль')).toBeNull();
    });

    it('strips control characters and collapses the result', () => {
      expect(asciiWindowName('a\u0000b\tc')).toBe('a b c');
    });

    it('returns null for an empty or whitespace-only title', () => {
      expect(asciiWindowName('')).toBeNull();
      expect(asciiWindowName('   ')).toBeNull();
    });

    it('truncates to the shared limit so both mechanisms carry the same string', () => {
      expect(asciiWindowName('y'.repeat(300))?.length).toBe(96);
    });
  });

  describe('planWindowTitle', () => {
    it('uses the kernel flag for an ASCII name', () => {
      expect(planWindowTitle('kz-01', '[KZ] ')).toEqual({ flagValue: '[KZ] kz-01', keeperTitle: null });
    });

    it('uses the WinAPI keeper for a Cyrillic name', () => {
      // The whole point of the split: this is the case the flag cannot carry, and before the
      // fix it silently fell back to the page title.
      expect(planWindowTitle('Профиль 1')).toEqual({ flagValue: null, keeperTitle: 'Профиль 1' });
    });

    it('carries the badge on the keeper path too, so a coloured profile still shows it', () => {
      expect(planWindowTitle('Профиль', '[ПР] ')).toEqual({
        flagValue: null,
        keeperTitle: '[ПР] Профиль',
      });
    });

    it('plans nothing when there is no title to set, so a nameless profile is not touched', () => {
      expect(planWindowTitle(null)).toEqual({ flagValue: null, keeperTitle: null });
      expect(planWindowTitle('   ')).toEqual({ flagValue: null, keeperTitle: null });
    });

    it('never returns both mechanisms at once', () => {
      // Both at once is not a belt-and-braces combination: the kernel reverts the WinAPI write.
      for (const name of ['kz-01', 'Профиль 1', '', null, 'mixed kz Профиль']) {
        const plan = planWindowTitle(name, '[X] ');
        expect(plan.flagValue === null || plan.keeperTitle === null).toBe(true);
      }
    });
  });
});
