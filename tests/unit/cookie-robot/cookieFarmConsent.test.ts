import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page, ElementHandle } from 'puppeteer-core';
import {
  acceptCookieConsent,
  evaluateTextConsent,
  matchesConsentVerb,
  isForbiddenText,
  normalizeConsentText,
  CONSENT_VERBS,
  AUTH_DENYLIST,
  FORBIDDEN_CONSENT_FRAGMENTS,
} from '../../../src/main/scripts/modules/cookieFarm/consent';
import {
  selectFarmSites,
  FARM_SITES,
} from '../../../src/main/scripts/modules/cookieFarm/sites';

interface FakeElementOptions {
  text?: string;
  visible?: boolean;
  clickThrow?: boolean;
  box?: { width: number; height: number } | null;
}

function createFakeElementHandle(opts: FakeElementOptions = {}): ElementHandle<Element> {
  const isVisible = opts.visible !== false;
  const clickFn = opts.clickThrow
    ? vi.fn().mockRejectedValue(new Error('Detached node or covered element'))
    : vi.fn().mockResolvedValue(undefined);

  const box = isVisible ? (opts.box ?? { x: 10, y: 10, width: 120, height: 36 }) : null;

  return {
    click: clickFn,
    boundingBox: vi.fn().mockResolvedValue(box),
    evaluate: vi.fn().mockImplementation(async (fn: any) => {
      if (typeof fn === 'function') {
        const mockNode = {
          textContent: opts.text ?? '',
          innerText: opts.text ?? '',
          getAttribute: (attr: string) => (attr === 'aria-label' ? opts.text ?? null : null),
        };
        try {
          return fn(mockNode);
        } catch {
          return opts.text ?? '';
        }
      }
      return opts.text ?? '';
    }),
  } as unknown as ElementHandle<Element>;
}

describe('Cookie Farm Consent Module', () => {
  let originalDocument: any;
  let originalWindow: any;

  beforeEach(() => {
    originalDocument = (globalThis as any).document;
    originalWindow = (globalThis as any).window;
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  describe('Pass 1: Selector matching', () => {
    it('a page exposing an accept selector yields {clicked:true, via:"selector"}', async () => {
      const mockElement = createFakeElementHandle({
        text: 'Accept All Cookies',
        visible: true,
      });

      const mockPage = {
        $$: vi.fn().mockImplementation(async (selector: string) => {
          if (selector === '#onetrust-accept-btn-handler') {
            return [mockElement];
          }
          return [];
        }),
        evaluate: vi.fn().mockResolvedValue({ clicked: false }),
      } as unknown as Page;

      const outcome = await acceptCookieConsent(mockPage);

      expect(outcome).toEqual({
        clicked: true,
        label: 'Accept All Cookies',
        via: 'selector',
      });
      expect(mockElement.click).toHaveBeenCalledTimes(1);
    });

    it('tries subsequent CMP selectors when earlier selectors yield no elements', async () => {
      const mockElement = createFakeElementHandle({
        text: 'Agree',
        visible: true,
      });

      const mockPage = {
        $$: vi.fn().mockImplementation(async (selector: string) => {
          // OneTrust not found, but Didomi is present
          if (selector === '#didomi-notice-agree-button') {
            return [mockElement];
          }
          return [];
        }),
        evaluate: vi.fn().mockResolvedValue({ clicked: false }),
      } as unknown as Page;

      const outcome = await acceptCookieConsent(mockPage);

      expect(outcome).toEqual({
        clicked: true,
        label: 'Agree',
        via: 'selector',
      });
      expect(mockElement.click).toHaveBeenCalledTimes(1);
    });

    it('skips invisible elements in selector pass and clicks the first visible one', async () => {
      const hiddenElement = createFakeElementHandle({
        text: 'Accept hidden',
        visible: false,
      });
      const visibleElement = createFakeElementHandle({
        text: 'Accept visible',
        visible: true,
      });

      const mockPage = {
        $$: vi.fn().mockImplementation(async (selector: string) => {
          if (selector === '#onetrust-accept-btn-handler') {
            return [hiddenElement, visibleElement];
          }
          return [];
        }),
        evaluate: vi.fn().mockResolvedValue({ clicked: false }),
      } as unknown as Page;

      const outcome = await acceptCookieConsent(mockPage);

      expect(outcome).toEqual({
        clicked: true,
        label: 'Accept visible',
        via: 'selector',
      });
      expect(hiddenElement.click).not.toHaveBeenCalled();
      expect(visibleElement.click).toHaveBeenCalledTimes(1);
    });
  });

  describe('Pass 2: Text matching & fallbacks', () => {
    it('a page whose only consent control is text-only yields {clicked:true, via:"text"}', async () => {
      const buttonClick = vi.fn();
      const mockButton = {
        tagName: 'BUTTON',
        innerText: 'Принять все',
        textContent: 'Принять все',
        getAttribute: (_attr: string) => null,
        className: 'btn-primary',
        id: 'btn-accept',
        getBoundingClientRect: () => ({ width: 100, height: 40 }),
        click: buttonClick,
      };

      (globalThis as any).document = {
        querySelectorAll: vi.fn().mockReturnValue([mockButton]),
      };
      (globalThis as any).window = {
        getComputedStyle: vi.fn().mockReturnValue({
          display: 'block',
          visibility: 'visible',
          opacity: '1',
        }),
      };

      const mockPage = {
        $$: vi.fn().mockResolvedValue([]),
        evaluate: vi.fn().mockImplementation(async (fn: any, ...args: any[]) => {
          if (typeof fn === 'function') {
            return fn(...args);
          }
          return { clicked: false };
        }),
      } as unknown as Page;

      const outcome = await acceptCookieConsent(mockPage);

      expect(outcome).toEqual({
        clicked: true,
        label: 'Принять все',
        via: 'text',
      });
      expect(buttonClick).toHaveBeenCalledTimes(1);
    });

    it('prefers the SHORTEST match among candidate consent controls', () => {
      const longButtonClick = vi.fn();
      const shortButtonClick = vi.fn();

      const longButton = {
        tagName: 'BUTTON',
        innerText: 'Accept all cookies and close',
        textContent: 'Accept all cookies and close',
        getAttribute: (_attr: string) => null,
        className: 'btn-secondary',
        id: 'btn-long',
        getBoundingClientRect: () => ({ width: 200, height: 40 }),
        click: longButtonClick,
      };

      const shortButton = {
        tagName: 'BUTTON',
        innerText: 'OK',
        textContent: 'OK',
        getAttribute: (_attr: string) => null,
        className: 'btn-primary',
        id: 'btn-short',
        getBoundingClientRect: () => ({ width: 60, height: 36 }),
        click: shortButtonClick,
      };

      (globalThis as any).document = {
        querySelectorAll: vi.fn().mockReturnValue([longButton, shortButton]),
      };
      (globalThis as any).window = {
        getComputedStyle: vi.fn().mockReturnValue({
          display: 'block',
          visibility: 'visible',
          opacity: '1',
        }),
      };

      const result = evaluateTextConsent(
        CONSENT_VERBS as unknown as string[],
        AUTH_DENYLIST as unknown as string[],
        40,
        FORBIDDEN_CONSENT_FRAGMENTS as unknown as string[]
      );

      expect(result).toEqual({
        clicked: true,
        label: 'OK',
      });
      expect(shortButtonClick).toHaveBeenCalledTimes(1);
      expect(longButtonClick).not.toHaveBeenCalled();
    });
  });

  describe('No CMP & Empty page handling', () => {
    it('a page with no CMP yields {clicked:false} and does not throw', async () => {
      const mockPage = {
        $$: vi.fn().mockResolvedValue([]),
        evaluate: vi.fn().mockResolvedValue({ clicked: false }),
      } as unknown as Page;

      const outcome = await acceptCookieConsent(mockPage);

      expect(outcome).toEqual({ clicked: false });
    });

    it('gracefully handles null, undefined, or broken page objects without throwing', async () => {
      expect(await acceptCookieConsent(null as unknown as Page)).toEqual({ clicked: false });
      expect(await acceptCookieConsent(undefined as unknown as Page)).toEqual({ clicked: false });
      expect(await acceptCookieConsent({} as unknown as Page)).toEqual({ clicked: false });

      const throwingPage = {
        $$: vi.fn().mockRejectedValue(new Error('Session closed')),
        evaluate: vi.fn().mockRejectedValue(new Error('Target crashed')),
      } as unknown as Page;

      expect(await acceptCookieConsent(throwingPage)).toEqual({ clicked: false });
    });
  });

  describe('Fault tolerance & Click error survival', () => {
    it('a click that throws is survived (next candidate is tried / result returns, never rejects)', async () => {
      const throwingElement = createFakeElementHandle({
        text: 'Broken Accept',
        visible: true,
        clickThrow: true,
      });
      const workingElement = createFakeElementHandle({
        text: 'Working Accept',
        visible: true,
        clickThrow: false,
      });

      const mockPage = {
        $$: vi.fn().mockImplementation(async (selector: string) => {
          if (selector === '#onetrust-accept-btn-handler') {
            return [throwingElement, workingElement];
          }
          return [];
        }),
        evaluate: vi.fn().mockResolvedValue({ clicked: false }),
      } as unknown as Page;

      const outcome = await acceptCookieConsent(mockPage);

      expect(outcome).toEqual({
        clicked: true,
        label: 'Working Accept',
        via: 'selector',
      });
      expect(throwingElement.click).toHaveBeenCalledTimes(1);
      expect(workingElement.click).toHaveBeenCalledTimes(1);
    });

    it('returns {clicked:false} when all candidate clicks throw, without rejecting', async () => {
      const throwingElement = createFakeElementHandle({
        text: 'Broken Accept',
        visible: true,
        clickThrow: true,
      });

      const mockPage = {
        $$: vi.fn().mockResolvedValue([throwingElement]),
        evaluate: vi.fn().mockRejectedValue(new Error('Frame detached')),
      } as unknown as Page;

      const outcome = await acceptCookieConsent(mockPage);

      expect(outcome).toEqual({ clicked: false });
    });
  });

  describe('Auth & Transaction Safety Denylist', () => {
    it('the denylist holds: a button reading "Sign in with Google" is not clicked', async () => {
      const authElement = createFakeElementHandle({
        text: 'Sign in with Google',
        visible: true,
      });

      const mockPage = {
        $$: vi.fn().mockResolvedValue([authElement]),
        evaluate: vi.fn().mockResolvedValue({ clicked: false }),
      } as unknown as Page;

      const outcome = await acceptCookieConsent(mockPage);

      expect(authElement.click).not.toHaveBeenCalled();
      expect(outcome).toEqual({ clicked: false });
    });

    it('denylist holds in text evaluation pass: auth and checkout controls are ignored', () => {
      const authClick = vi.fn();
      const authButton = {
        tagName: 'BUTTON',
        innerText: 'Sign in with Google',
        textContent: 'Sign in with Google',
        getAttribute: (_attr: string) => null,
        className: 'google-login',
        id: 'google-auth',
        getBoundingClientRect: () => ({ width: 150, height: 40 }),
        click: authClick,
      };

      (globalThis as any).document = {
        querySelectorAll: vi.fn().mockReturnValue([authButton]),
      };
      (globalThis as any).window = {
        getComputedStyle: vi.fn().mockReturnValue({
          display: 'block',
          visibility: 'visible',
          opacity: '1',
        }),
      };

      const result = evaluateTextConsent(
        CONSENT_VERBS as unknown as string[],
        AUTH_DENYLIST as unknown as string[],
        40,
        FORBIDDEN_CONSENT_FRAGMENTS as unknown as string[]
      );

      expect(result).toEqual({ clicked: false });
      expect(authClick).not.toHaveBeenCalled();
    });

    it('correctly identifies forbidden auth and transaction text across languages', () => {
      expect(isForbiddenText('Sign in')).toBe(true);
      expect(isForbiddenText('Sign in with Google')).toBe(true);
      expect(isForbiddenText('Login to your account')).toBe(true);
      expect(isForbiddenText('Checkout / Pay now')).toBe(true);
      expect(isForbiddenText('Войти в личный кабинет')).toBe(true);
      expect(isForbiddenText('Купить билет')).toBe(true);
      expect(isForbiddenText('Accept all')).toBe(false);
      expect(isForbiddenText('Принять все')).toBe(false);
    });
  });

  describe('Multilingual Consent Verb Matching', () => {
    it('matches valid consent verbs across EN, RU, DE, FR, ES', () => {
      // EN
      expect(matchesConsentVerb('Accept all')).toBe(true);
      expect(matchesConsentVerb('I agree')).toBe(true);
      expect(matchesConsentVerb('Got it')).toBe(true);
      expect(matchesConsentVerb('OK')).toBe(true);
      // RU
      expect(matchesConsentVerb('Принять все')).toBe(true);
      expect(matchesConsentVerb('Принять всё')).toBe(true);
      expect(matchesConsentVerb('Согласен')).toBe(true);
      expect(matchesConsentVerb('Понял')).toBe(true);
      // DE
      expect(matchesConsentVerb('Alle akzeptieren')).toBe(true);
      expect(matchesConsentVerb('Einverstanden')).toBe(true);
      // FR
      expect(matchesConsentVerb('Tout accepter')).toBe(true);
      expect(matchesConsentVerb("J'accepte")).toBe(true);
      // ES
      expect(matchesConsentVerb('Aceptar todo')).toBe(true);
      expect(matchesConsentVerb('De acuerdo')).toBe(true);
    });

    it('rejects settings and customization options even if containing consent words', () => {
      expect(matchesConsentVerb('Manage settings')).toBe(false);
      expect(matchesConsentVerb('Accept only necessary')).toBe(false);
      expect(matchesConsentVerb('Customize cookies')).toBe(false);
      expect(matchesConsentVerb('Настроить куки')).toBe(false);
      expect(matchesConsentVerb('Только необходимые')).toBe(false);
    });

    it('normalizes punctuation and emojis cleanly', () => {
      expect(normalizeConsentText('✓ Accept all!')).toBe('accept all');
      expect(normalizeConsentText('  Принять все ... ')).toBe('принять все');
    });
  });

  describe('Determinism of selectFarmSites', () => {
    it('selectFarmSites(seed, n) twice with the same args is deep-equal', () => {
      const run1 = selectFarmSites(42, 10);
      const run2 = selectFarmSites(42, 10);
      expect(run1).toEqual(run2);

      const runA = selectFarmSites(999999, 5);
      const runB = selectFarmSites(999999, 5);
      expect(runA).toEqual(runB);
    });

    it('two different seeds differ', () => {
      const listA = selectFarmSites(12345, 12);
      const listB = selectFarmSites(67890, 12);
      expect(listA).not.toEqual(listB);
    });

    it('n never exceeds FARM_SITES.length', () => {
      const totalAvailable = FARM_SITES.length;
      expect(totalAvailable).toBeGreaterThanOrEqual(30);

      const selectedOverLimit = selectFarmSites(42, 999999);
      expect(selectedOverLimit.length).toBe(totalAvailable);
      expect(selectedOverLimit.length).toBeLessThanOrEqual(totalAvailable);

      const exact = selectFarmSites(42, totalAvailable);
      expect(exact.length).toBe(totalAvailable);
    });

    it('categories are not all one category for n >= 7', () => {
      const sites = selectFarmSites(42, 7);
      expect(sites.length).toBe(7);

      const categories = new Set(sites.map((site) => site.category));
      expect(categories.size).toBeGreaterThan(1);
      // Round-robin design ensures all 7 distinct categories are represented
      expect(categories.size).toBe(7);
    });
  });
});

describe('the farm site pool stays usable and unambiguous', () => {
  it('lists no URL twice', () => {
    // A duplicate is not cosmetic: `selectFarmSites` removes a chosen entry from its pool, so two
    // entries for one URL let a single run visit the same site twice and report it as two domains.
    // Caught when the measured second wave was added and re-listed walmart.com.
    const urls = FARM_SITES.map((s) => s.url);
    const duplicates = urls.filter((u, i) => urls.indexOf(u) !== i);
    expect(duplicates, `duplicate farm sites: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('can satisfy the largest page count a run can request, across many categories', () => {
    // The runner asks for up to `maxPages` sites (default 20). If the pool were smaller than a
    // request, a run would silently visit fewer sites than the operator asked for.
    const selected = selectFarmSites(4242, 20);
    expect(selected).toHaveLength(20);
    expect(new Set(selected.map((s) => s.url)).size, 'a run must not repeat a site').toBe(20);
    // Category round-robin is the reason the pool is spread rather than deep: a footprint that
    // only ever touches shopping sites is not a browsing history.
    expect(new Set(selected.map((s) => s.category)).size).toBeGreaterThanOrEqual(5);
  });

  it('every site is an https URL', () => {
    // An http entry would send the profile's traffic in the clear, which contradicts the point of
    // warming a profile behind a proxy.
    const insecure = FARM_SITES.filter((s) => !s.url.startsWith('https://'));
    expect(insecure.map((s) => s.url)).toEqual([]);
  });
});

describe('the two consent matchers agree', () => {
  /*
   * `matchesConsentVerb` runs in Node; `evaluateTextConsent` is serialized into Chromium by
   * Puppeteer and cannot call it. Two implementations of one rule is exactly how the prefix rule
   * was added to one copy and not the other, so this pins them together: any label either accepts
   * or refuses, both must agree. When they diverge, the unit tests describe behaviour the real
   * browser run does not have — the failure mode this test exists to prevent.
   */
  const LABELS = [
    'Accept All', 'Accept all cookies and continue', 'I accept the use of cookies',
    'Agree and continue', 'Alle akzeptieren und weiter', 'Принять все и продолжить',
    'Tout accepter et continuer', 'Aceptar todas las cookies', 'Accetta tutti i cookie',
    'Reject all', 'Accept only necessary', 'Manage settings', 'Customize preferences',
    'Отказаться', 'Ablehnen', 'Refuser', 'Rechazar', 'You can accept or reject cookies',
    'Settings', 'Cookie settings', 'Accept selected', 'Nur notwendige', 'Настроить',
    'Sign in with Google', 'Subscribe now', 'Buy now', 'Log in', '',
  ];

  it.each(LABELS)('agrees on %j', (label) => {
    const viaNode = matchesConsentVerb(label);

    const el = {
      innerText: label,
      textContent: label,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ width: 120, height: 32 }),
      click: () => {},
    };
    const originalDocument = (globalThis as unknown as { document?: unknown }).document;
    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    (globalThis as unknown as { document?: unknown }).document = {
      querySelectorAll: () => [el],
    };
    (globalThis as unknown as { window?: unknown }).window = {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    };
    const viaPage = evaluateTextConsent(
      CONSENT_VERBS as unknown as string[],
      AUTH_DENYLIST as unknown as string[],
      40,
      FORBIDDEN_CONSENT_FRAGMENTS as unknown as string[],
    );
    (globalThis as unknown as { document?: unknown }).document = originalDocument;
    (globalThis as unknown as { window?: unknown }).window = originalWindow;

    expect(viaPage.clicked, `in-page matcher disagreed with the Node matcher on "${label}"`)
      .toBe(viaNode);
  });
});

describe('no farm site trips the robot challenge detector', () => {
  /*
   * The robot skips a page (and logs an error) when its title or URL contains a challenge keyword
   * such as "cloudflare". That makes a site whose own URL contains the keyword permanently
   * unusable: cloudflare.com was measured setting 3 cookies and was still unlistable, because the
   * detector matched the word inside its own hostname and skipped it on every visit. Cheap to
   * check here; expensive to discover as a mystery skip in a run log.
   */
  const CHALLENGE_KEYWORDS = [
    'just a moment', 'attention required', 'cloudflare', 'captcha', 'are you human', '/sorry/',
  ];

  it('lists no site whose URL would be skipped as a challenge', () => {
    const selfFlagging = FARM_SITES.filter((site) =>
      CHALLENGE_KEYWORDS.some((kw) => site.url.toLowerCase().includes(kw)),
    );
    expect(
      selfFlagging.map((s) => s.url),
      'these sites would be skipped on every visit by the challenge detector',
    ).toEqual([]);
  });

describe('a label that starts with a verb but refuses is still refused', () => {
  /*
   * The prefix rule is the fix for banners that phrase acceptance as a sentence, and it is also the
   * risk: a label can BEGIN with a consent verb and still mean "only what is necessary", "accept
   * nothing", or "accept and reject". Every case below was found by attacking the rule rather than
   * trusting it — "Accept no cookies", "Accetta solo i necessari" and "Akzeptieren und ablehnen"
   * were all CLICKED until the qualifier and negation fragments were added.
   *
   * Clicking one of these is worse than clicking nothing: it records a refusal the operator did not
   * choose, or opens a preferences dialog that blocks the page.
   */
  const MUST_REFUSE = [
    'Accept only necessary cookies', 'Accept and manage preferences', 'Accept selected cookies',
    'Accetta solo i necessari', 'Solo accetta i necessari', 'Accept only essential',
    'Akzeptieren und ablehnen', 'Alle akzeptieren und ablehnen', 'Nur notwendige akzeptieren',
    'Accepter et refuser', 'Aceptar y rechazar', 'Принять и отказаться',
    'Accept no cookies', 'Accept zero cookies', 'Agree to disagree',
    // Round two, found by an independent reviewer attacking the rule AFTER the first fixes landed:
    // every one of these begins with a verb and accepts less than everything, and all were clicked.
    'Accept nothing', 'Accept nothing at all', 'Accept none', 'Accept zero',
    'Accept minimal cookies', 'Accept nur das Nötigste',
    'Accept all, but let me customize', 'Accept cookies settings',
    'Allow all third-party trackers to be disabled', 'Tout accepter mais pas les pubs',
  ];

  it.each(MUST_REFUSE)('refuses %j', (label) => {
    expect(matchesConsentVerb(label), `"${label}" must never be treated as an accept action`).toBe(false);
  });

  it('still clicks the legitimate phrasing the prefix rule exists for', () => {
    // Guards against the fix above being applied so broadly that real banners stop working.
    const MUST_CLICK = [
      'accept all', 'accept all cookies', 'accept all cookies and continue',
      'i accept the use of cookies', 'agree and continue', 'accept terms and conditions',
      'i accept the privacy policy', 'accept all cookies to continue shopping',
      'alle akzeptieren und weiter', 'принять все и продолжить', 'tout accepter et continuer',
      'aceptar todas las cookies', 'accetta tutti i cookie', 'aceitar e continuar',
      'zaakceptuj wszystkie', 'tümünü kabul et', 'acceptera alla', 'принять и закрыть',
    ];
    const missed = MUST_CLICK.filter((label) => !matchesConsentVerb(label));
    expect(missed, `these legitimate labels stopped matching: ${missed.join(', ')}`).toEqual([]);
  });
});


describe('diacritics survive normalization, and partial accepts are refused', () => {
  /*
   * Two defects found by an independent reviewer attacking this module BEFORE release, both proven
   * by execution rather than inspection:
   *
   * 1. The boundary-stripping regex was `[^a-zа-яё0-9]`, which treats every Latin letter outside
   *    ASCII as punctuation. It amputated the edge character of any label carrying a diacritic, so
   *    Polish and Hungarian verbs this module advertises could never match: "akceptuję" normalised
   *    to "akceptuj", "zgadzam się" to "zgadzam si", "összes elfogadása" lost its first letter.
   *
   * 2. "Accept essential cookies" and "Accept functional cookies" are PARTIAL accepts — the
   *    opposite of what a warm-up wants — and matched the `accept` verb, so the robot recorded a
   *    restricted consent the operator never chose.
   */
  const MUST_CLICK = [
    // Diacritic-bearing verbs that the ASCII-only normalizer made unmatchable.
    'akceptuję', 'Akceptuję', 'zgadzam się', 'Zgadzam się', 'zaakceptuj wszystkie',
    'összes elfogadása', 'Összes elfogadása', 'přijmout vše', 'souhlasím',
    'Tümünü kabul et', 'Acceptera alla',
  ];
  const MUST_REFUSE = [
    'Accept essential cookies', 'Accept functional cookies',
    'Accept required cookies', 'Accept strictly necessary',
  ];

  it.each(MUST_CLICK)('clicks %j despite its diacritics', (label) => {
    expect(matchesConsentVerb(label), `"${label}" must match a verb in the list`).toBe(true);
  });

  it.each(MUST_REFUSE)('refuses the partial accept %j', (label) => {
    expect(matchesConsentVerb(label), `"${label}" consents to a SUBSET and must not be clicked`).toBe(false);
  });

  it('strips surrounding punctuation without eating letters', () => {
    // The rule exists to drop quotes and bullets, not characters from the alphabet.
    expect(normalizeConsentText('«Accept all»')).toBe('accept all');
    expect(normalizeConsentText('"Accept all"')).toBe('accept all');
    expect(normalizeConsentText('• Accept all')).toBe('accept all');
    // …and a diacritic at either edge must survive untouched.
    expect(normalizeConsentText('akceptuję')).toBe('akceptuję');
    expect(normalizeConsentText('összes elfogadása')).toBe('összes elfogadása');
  });
});

});
