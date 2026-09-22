import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page, ElementHandle } from 'puppeteer-core';
import {
  acceptCookieConsent,
  evaluateTextConsent,
  matchesConsentVerb,
  isForbiddenText,
  normalizeConsentText,
  CMP_SELECTORS,
  CONSENT_VERBS,
  AUTH_DENYLIST,
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
        getAttribute: (attr: string) => null,
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
        getAttribute: (attr: string) => null,
        className: 'btn-secondary',
        id: 'btn-long',
        getBoundingClientRect: () => ({ width: 200, height: 40 }),
        click: longButtonClick,
      };

      const shortButton = {
        tagName: 'BUTTON',
        innerText: 'OK',
        textContent: 'OK',
        getAttribute: (attr: string) => null,
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
        40
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
        getAttribute: (attr: string) => null,
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
        40
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
