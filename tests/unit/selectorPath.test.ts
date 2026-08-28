import { describe, it, expect } from 'vitest';
import {
  selectorPathFromSteps,
  parseSelectorPath,
  selectorStepsMatch,
  nthOfTypeSelector,
  cssEscapeIdent,
} from '../../src/main/util/selectorPath';

describe('selector path builder (Sprint 3.2)', () => {
  it('builds nth-of-type chains from steps', () => {
    const path = selectorPathFromSteps([
      { tag: 'body', nth: 1 },
      { tag: 'div', nth: 2 },
      { tag: 'button', nth: 3 },
    ]);
    expect(path).toBe('body:nth-of-type(1) > div:nth-of-type(2) > button:nth-of-type(3)');
  });

  it('prefers id steps when present', () => {
    const path = selectorPathFromSteps([
      { tag: 'body', nth: 1 },
      { tag: '', nth: 1, id: 'login-form' },
      { tag: 'input', nth: 1 },
    ]);
    expect(path).toBe('body:nth-of-type(1) > #login-form > input:nth-of-type(1)');
  });

  it('round-trips through parseSelectorPath', () => {
    const steps = [
      { tag: 'body', nth: 1 },
      { tag: 'div', nth: 2 },
      { tag: 'button', nth: 3 },
    ];
    const parsed = parseSelectorPath(selectorPathFromSteps(steps));
    expect(parsed).toEqual(steps);
  });

  it('parses id steps back', () => {
    const parsed = parseSelectorPath('#login-form > input:nth-of-type(2)');
    expect(parsed).toEqual([
      { tag: '', nth: 1, id: 'login-form' },
      { tag: 'input', nth: 2 },
    ]);
  });

  it('matching: equal chains match, different nth or tag do not', () => {
    const master = [
      { tag: 'body', nth: 1 },
      { tag: 'div', nth: 2 },
    ];
    expect(selectorStepsMatch(master, [{ tag: 'body', nth: 1 }, { tag: 'div', nth: 2 }])).toBe(true);
    expect(selectorStepsMatch(master, [{ tag: 'body', nth: 1 }, { tag: 'div', nth: 3 }])).toBe(false);
    expect(selectorStepsMatch(master, [{ tag: 'body', nth: 1 }, { tag: 'span', nth: 2 }])).toBe(false);
    expect(selectorStepsMatch(master, [])).toBe(false);
  });

  it('matching: matching ids win over nth; mismatched ids fail', () => {
    const master = [{ tag: '', nth: 1, id: 'app' }, { tag: 'a', nth: 1 }];
    expect(selectorStepsMatch(master, [{ tag: '', nth: 1, id: 'app' }, { tag: 'a', nth: 1 }])).toBe(true);
    expect(selectorStepsMatch(master, [{ tag: '', nth: 1, id: 'other' }, { tag: 'a', nth: 1 }])).toBe(false);
    // id present on master but missing on slave -> falls back to tag/nth
    expect(selectorStepsMatch(master, [{ tag: '', nth: 1 }, { tag: 'a', nth: 1 }])).toBe(true);
  });

  it('nth-of-type is clamped to >=1', () => {
    expect(nthOfTypeSelector('div', 0)).toBe('div:nth-of-type(1)');
    expect(nthOfTypeSelector('div', -3)).toBe('div:nth-of-type(1)');
    expect(nthOfTypeSelector('div', 2.7)).toBe('div:nth-of-type(3)');
  });

  it('css identifier escape keeps selectors query-safe', () => {
    expect(cssEscapeIdent('login-form')).toBe('login-form');
    expect(cssEscapeIdent('user:name')).toBe('user\\:name');
    expect(cssEscapeIdent('a b')).toBe('a\\ b');
  });
});