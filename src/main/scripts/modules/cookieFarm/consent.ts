import type { Frame, Page } from 'puppeteer-core';

/**
 * The element operations the consent detector performs, as a structural type.
 *
 * Spelled out instead of reusing Puppeteer's `ElementHandle<Element>`: that type parameter
 * resolves to the DOM's global `Element`, and this file compiles under the main-process
 * tsconfig, which deliberately carries no DOM lib. A real `ElementHandle` satisfies this
 * interface structurally, so no cast is needed where the handles are produced.
 *
 * Only the members the detector calls are declared. `evaluate` is deliberately absent: the
 * helpers that need it reach for it through a runtime `typeof` check, because the unit tests
 * pass plain object stand-ins that carry `click`/`boundingBox` but no Puppeteer class.
 */
export interface ConsentElement {
  boundingBox(): Promise<{ width: number; height: number } | null>;
  click(): Promise<void>;
}

/**
 * An element handle that can also run a function inside the page.
 *
 * Declared separately from {@link ConsentElement} because Puppeteer's own `evaluate` carries a
 * generic `Func extends EvaluateFuncWith<...>` signature that no narrower declaration is
 * assignable to, while the query result type must stay assignable from `page.$$`.
 */
interface EvaluatableElement {
  evaluate(pageFunction: (node: unknown) => unknown): Promise<unknown>;
}

/**
 * Outcome of looking for a consent control on the current page.
 * Matches frozen interface in openspec/changes/cookie-farm-module/interfaces.md
 */
export interface ConsentOutcome {
  clicked: boolean;
  /** Text of the control that was clicked, for the report. */
  label?: string;
  /** How it was matched. */
  via?: 'selector' | 'text';
}

/**
 * Module-level list of real CMP controls (~10-14 entries).
 * Evaluated in order during the selector pass.
 */
export const CMP_SELECTORS: readonly string[] = [
  // 1. OneTrust: primary accept button in standard banner
  '#onetrust-accept-btn-handler',
  // 2. Didomi: agreement button in standard notice dialog
  '#didomi-notice-agree-button',
  // 3. Quantcast Choice CMP2: primary action button in summary buttons container
  '.qc-cmp2-summary-buttons button[mode="primary"]',
  // 4. Usercentrics / Sourcepoint CMP: test-id for accept-all button
  '[data-testid="uc-accept-all-button"]',
  // 5. Cookiebot: allow all opt-in button in dialog body level
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  // 6. OneTrust alternative: recommended choices accept button
  '#accept-recommended-btn-handler',
  // 7. Osano: accept all cookies banner button
  '.osano-cm-accept-all',
  // 8. Consentmanager: welcome button yes link/button
  '#cmpwelcomebtnyes a',
  // 9. Generic CMP ID: button with cookie and accept tokens in id
  'button[id*="cookie" i][id*="accept" i]',
  // 10. Generic CMP Class: button with cookie and accept tokens in class
  'button[class*="cookie" i][class*="accept" i]',
  // 11. Generic ARIA: button with accept token in aria-label attribute
  'button[aria-label*="accept" i]',
  // 12. Generic Consent Dialog: container with consent id holding an accept-class button
  '[id*="consent" i] button[class*="accept" i]',
];

/**
 * Whitelist of consent verbs across EN, RU, DE, FR, ES.
 * Used in the text fallback pass.
 */
export const CONSENT_VERBS: readonly string[] = [
  // English
  'accept all',
  'accept',
  'agree',
  'allow all',
  'allow',
  'i agree',
  'got it',
  'ok',
  'okay',
  'accept cookies',
  'accept all cookies',
  'agree to all',
  'allow all cookies',
  'allow cookies',
  'i accept',
  // Russian
  'понял',
  'принять',
  'согласен',
  'согласиться',
  'принять все',
  'принять всё',
  'принять все куки',
  'разрешить все',
  'разрешить всё',
  'я согласен',
  'хорошо',
  // German
  'alle akzeptieren',
  'akzeptieren',
  'zustimmen',
  'einverstanden',
  'alle erlauben',
  'cookies akzeptieren',
  // French
  'tout accepter',
  'accepter',
  "j'accepte",
  'autoriser tout',
  "d'accord",
  'accepter les cookies',
  'accepter tous les cookies',
  // Spanish
  'aceptar todo',
  'aceptar todas',
  'aceptar',
  'de acuerdo',
  'permitir todas',
  'permitir todo',
  'aceptar cookies',
  'aceptar todas las cookies',
];

/**
 * Auth and transaction safety denylist.
 * Derived from the auth heuristics in findSafeInternalLink (cookieRobot.ts).
 * Kept local to avoid cyclical dependencies between cookieFarm and cookieRobot modules.
 * NEVER click controls matching these keywords (R16/R17 safety requirements).
 */
export const AUTH_DENYLIST: readonly string[] = [
  'login',
  'log in',
  'signin',
  'sign in',
  'sign-in',
  'sign_in',
  'auth',
  'password',
  'register',
  'signup',
  'sign up',
  'sign-up',
  'sign_up',
  'logout',
  'log out',
  'checkout',
  'account',
  'submit',
  'oauth',
  'token',
  'buy',
  'purchase',
  'cart',
  'subscribe',
  'order',
  // Russian auth/transaction keywords
  'войти',
  'вход',
  'авториз',
  'регистрац',
  'купить',
  'оформить',
  'корзин',
  'пароль',
  'аккаунт',
  'подписк',
];

/**
 * Normalizes text for matching against consent verbs.
 * Strips leading/trailing punctuation, symbols, emojis, and normalizes spaces.
 */
export function normalizeConsentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if a string contains any forbidden auth or transaction keywords.
 */
export function isForbiddenText(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return AUTH_DENYLIST.some((kw) => lower.includes(kw));
}

/**
 * Checks if a string matches any whitelisted consent verb.
 */
export function matchesConsentVerb(text: string): boolean {
  const norm = normalizeConsentText(text);
  if (!norm) return false;

  // Reject explicit settings / customization / rejection phrases even if they contain 'accept'
  if (
    norm.includes('necessary') ||
    norm.includes('selected') ||
    norm.includes('manage') ||
    norm.includes('settings') ||
    norm.includes('customize') ||
    norm.includes('настроить') ||
    norm.includes('только') ||
    norm.includes('nur notwendige')
  ) {
    return false;
  }

  return CONSENT_VERBS.some((verb) => norm === verb);
}

/** The DOM surface the in-page visibility check reads. */
interface StyledNode {
  getComputedStyle(node: unknown): { display?: string; visibility?: string; opacity?: string } | null;
}

/**
 * Whether the handle can run a function in the page.
 * The unit tests pass plain stand-ins carrying `click`/`boundingBox` only, so this must be a
 * runtime check rather than an interface member.
 */
function canEvaluateElement(el: ConsentElement): el is ConsentElement & EvaluatableElement {
  return typeof (el as Partial<EvaluatableElement>).evaluate === 'function';
}

/**
 * Checks if an element handle is visible on the page.
 */
async function isElementVisible(el: ConsentElement): Promise<boolean> {
  try {
    if (typeof el.boundingBox === 'function') {
      const box = await el.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) {
        return false;
      }
    }

    if (canEvaluateElement(el)) {
      const isHidden = await el
        .evaluate((node) => {
          // SAFETY: this callback body runs inside Chromium, where `window` is a real global;
          // the main-process tsconfig carries no DOM lib, so it is reached through globalThis.
          const win = (globalThis as unknown as { window?: StyledNode }).window;
          if (!win || typeof win.getComputedStyle !== 'function') return false;
          // SAFETY: Puppeteer passes the frame element as `node`; its DOM identity is not
          // available to this tsconfig, and only style reads are performed on it.
          const style = win.getComputedStyle(node);
          return (
            Boolean(style) &&
            (style?.display === 'none' ||
              style?.visibility === 'hidden' ||
              parseFloat(style?.opacity || '1') === 0)
          );
        })
        .catch(() => false);

      if (isHidden === true) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/** The DOM surface the in-page label extraction reads. */
interface LabelledNode {
  getAttribute?(name: string): string | null;
  innerText?: unknown;
  textContent?: unknown;
  value?: unknown;
}

/**
 * Extracts a visible label or accessible name from an element handle.
 */
async function getElementLabel(el: ConsentElement): Promise<string> {
  if (canEvaluateElement(el)) {
    try {
      const raw = await el.evaluate((node) => {
        // SAFETY: the callback runs in Chromium with the frame element as its argument; this
        // tsconfig has no DOM lib, so the node is read through a structural view.
        const el = node as LabelledNode;
        if (!el) return '';
        return (
          el.getAttribute?.('aria-label') ||
          (typeof el.innerText === 'string' ? el.innerText : '') ||
          (typeof el.textContent === 'string' ? el.textContent : '') ||
          el.getAttribute?.('title') ||
          (typeof el.value === 'string' ? el.value : '') ||
          ''
        );
      });
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
    } catch {
      // Fall through to the mock-property path below.
    }
  }

  // SAFETY: unit-test stand-ins expose the label as plain properties instead of via evaluate;
  // the values are re-checked as strings before use.
  const mockEl = el as unknown as { ariaLabel?: unknown; innerText?: unknown; textContent?: unknown };
  const fallback =
    (typeof mockEl.ariaLabel === 'string' ? mockEl.ariaLabel : '') ||
    (typeof mockEl.innerText === 'string' ? mockEl.innerText : '') ||
    (typeof mockEl.textContent === 'string' ? mockEl.textContent : '');
  return fallback.trim();
}

/**
 * Text pass evaluation function executed in the browser context via page.evaluate.
 * Completely self-contained so Puppeteer can serialize and execute it in Chromium.
 */
export function evaluateTextConsent(
  verbs: string[],
  denylist: string[],
  maxCandidates: number
): { clicked: boolean; label?: string } {
  // SAFETY: in-page evaluation in Chromium / test environment where DOM globals exist on globalThis
  const doc = (globalThis as unknown as { document?: any }).document;
  // SAFETY: in-page evaluation in Chromium / test environment where DOM globals exist on globalThis
  const win = (globalThis as unknown as { window?: any }).window;
  if (!doc) {
    return { clicked: false };
  }

  function isVisible(el: any): boolean {
    try {
      const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      if (win && typeof win.getComputedStyle === 'function') {
        const style = win.getComputedStyle(el);
        if (
          style &&
          (style.display === 'none' ||
            style.visibility === 'hidden' ||
            parseFloat(style.opacity || '1') === 0)
        ) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  function getElementText(el: any): string {
    const raw =
      (typeof el.getAttribute === 'function' && el.getAttribute('aria-label')) ||
      (typeof el.innerText === 'string' ? el.innerText : '') ||
      el.textContent ||
      (typeof el.getAttribute === 'function' && el.getAttribute('title')) ||
      (typeof el.value === 'string' ? el.value : '') ||
      '';
    return raw.trim();
  }

  function isForbidden(text: string, el: any): boolean {
    const href = (typeof el.getAttribute === 'function' && el.getAttribute('href')) || '';
    const combined = (
      text +
      ' ' +
      href +
      ' ' +
      (el.className || '') +
      ' ' +
      (el.id || '')
    ).toLowerCase();
    return denylist.some((kw) => combined.includes(kw));
  }

  function normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function matchesVerb(text: string): boolean {
    const norm = normalize(text);
    if (!norm) return false;

    if (
      norm.includes('necessary') ||
      norm.includes('selected') ||
      norm.includes('manage') ||
      norm.includes('settings') ||
      norm.includes('customize') ||
      norm.includes('настроить') ||
      norm.includes('только') ||
      norm.includes('nur notwendige')
    ) {
      return false;
    }

    return verbs.some((v) => norm === v);
  }

  try {
    const candidates = Array.from(
      doc.querySelectorAll(
        'button, a, [role="button"], input[type="button"], input[type="submit"]'
      )
    ) as any[];

    let inspected = 0;
    const matches: Array<{ el: any; text: string; len: number }> = [];

    for (const el of candidates) {
      if (inspected >= maxCandidates) break;
      inspected++;

      if (!isVisible(el)) continue;

      const text = getElementText(el);
      if (!text) continue;

      if (isForbidden(text, el)) continue;

      if (matchesVerb(text)) {
        matches.push({
          el,
          text,
          len: normalize(text).length,
        });
      }
    }

    // Prefer the SHORTEST match (primary banner button over long paragraphs/links)
    matches.sort((a, b) => a.len - b.len);

    for (const match of matches) {
      try {
        match.el.click();
        return { clicked: true, label: match.text };
      } catch {
        // Next candidate if click throws
        continue;
      }
    }
  } catch {
    return { clicked: false };
  }

  return { clicked: false };
}

/**
 * Find and click a cookie-consent control on the given Puppeteer page, if one exists.
 *
 * Matching strategy, in order:
 * 1. SELECTOR pass — checks real CMP controls (OneTrust, Didomi, Quantcast, Cookiebot, etc.).
 *    For each selector, queries visible elements and attempts to click the first visible match.
 *    Any click error is caught and the next candidate is tried.
 * 2. TEXT pass — falls back to page.evaluate over buttons/links/[role="button"] matching a
 *    multilingual whitelist of consent verbs, preferring the shortest match.
 * 3. Returns { clicked: false } if no candidate matched or could be clicked.
 *
 * Safety & Budget:
 * - Capped at ~2.5s wall-clock time and ~40 total candidates inspected.
 * - Never throws.
 * - Never clicks controls with text indicating auth, login, signup, or transactions.
 */
/**
 * One searchable document, reduced to the two operations the detector needs.
 *
 * Page and Frame both provide `$$`/`evaluate`/`url`, but they are unrelated classes — capturing
 * the operations as closures here keeps their union out of every call site in the detector.
 */
interface ConsentDocument {
  /** Human-readable origin, used to order CMP frames ahead of unrelated ones. */
  readonly origin: string;
  query(selector: string): Promise<ConsentElement[]>;
  runTextPass(maxCandidates: number): Promise<{ clicked: boolean; label?: string }>;
}

/** Frames whose origin typically serves a consent banner, matched to search them early. */
const CMP_FRAME_ORIGIN =
  /cmp|consent|cookie|privacy|sourcepoint|onetrust|didomi|quantcast|cookiebot|osano|usercentrics|trustarc|iubenda|sp_message|privacy-mgmt/i;

/**
 * Documents to search for a consent control, in priority order.
 *
 * **Why this exists.** Measured against real sites, a large share of CMP banners render inside a
 * cross-origin IFRAME — the Guardian's is served from `sourcepoint.theguardian.com`, and
 * OneTrust/Didomi commonly use `*.onetrust.com` / `*.didomi.io`. `page.$$` and `page.evaluate`
 * only ever see the top document, so those banners were unreachable by any selector or text
 * match and the module reported a clean `{clicked:false}` on a page that was showing a banner.
 *
 * The top document is searched FIRST, so an inline banner behaves exactly as before; frames whose
 * origin looks like a CMP follow, then the remainder.
 */
function consentDocuments(page: Page): ConsentDocument[] {
  const frameSupport = page as Partial<Pick<Page, 'mainFrame' | 'frames'>>;
  const main = typeof frameSupport.mainFrame === 'function' ? page.mainFrame() : undefined;
  const all = typeof frameSupport.frames === 'function' ? page.frames() : [];
  const rest = all.filter((frame) => frame !== main);

  const inOrder = main ? [main, ...rest.filter((f) => CMP_FRAME_ORIGIN.test(f.url())), ...rest.filter((f) => !CMP_FRAME_ORIGIN.test(f.url()))] : rest;

  const targets: Array<Frame | Page> = inOrder.length > 0 ? inOrder : [page];
  return targets.map((target) => {
    // A frame or page stand-in without `url()` is treated as the top document.
    let origin = '';
    try {
      origin = typeof target.url === 'function' ? target.url() : '';
    } catch {
      // A detached frame is unreadable; it will simply fail its queries below.
    }
    return {
      origin,
      query: (selector: string) => target.$$(selector),
      runTextPass: (maxCandidates: number) =>
        target.evaluate(evaluateTextConsent, [...CONSENT_VERBS], [...AUTH_DENYLIST], maxCandidates),
    };
  });
}

/** Shared wall-clock/candidate budget across every document searched in one call. */
interface ConsentBudget {
  deadline: number;
  inspected: number;
  maxCandidates: number;
}

/**
 * Hunt for a consent control in ONE document, honouring the shared budget.
 * Returns `null` when this document had nothing clickable (caller moves to the next frame).
 */
async function attemptConsentInDocument(
  document: ConsentDocument,
  budget: ConsentBudget
): Promise<ConsentOutcome | null> {
  // Four lockstep checks (two loops, two passes) share this one predicate by design.
  const hasBudget = (): boolean =>
    Date.now() < budget.deadline && budget.inspected < budget.maxCandidates;

  // -------------------------------------------------------------
  // Pass 1: SELECTOR pass
  // -------------------------------------------------------------
  for (const selector of CMP_SELECTORS) {
    if (!hasBudget()) return null;

    let elements: ConsentElement[] = [];
    try {
      elements = await document.query(selector);
    } catch {
      // Cross-origin frame or detached document: move on to the next selector.
      continue;
    }

    if (!elements || elements.length === 0) {
      continue;
    }

    for (const el of elements) {
      if (!hasBudget()) return null;
      budget.inspected++;

      const visible = await isElementVisible(el);
      if (!visible) continue;

      const label = await getElementLabel(el);
      if (isForbiddenText(label)) continue;

      try {
        await el.click();
        return {
          clicked: true,
          label: label || undefined,
          via: 'selector',
        };
      } catch {
        // Detached node or covered element: survive and try next candidate
        continue;
      }
    }
  }

  // -------------------------------------------------------------
  // Pass 2: TEXT pass
  // -------------------------------------------------------------
  if (hasBudget()) {
    try {
      const result = await document.runTextPass(budget.maxCandidates - budget.inspected);

      if (result && result.clicked) {
        return {
          clicked: true,
          label: result.label,
          via: 'text',
        };
      }
    } catch {
      // Survived page.evaluate failure — an unreadable frame is not a fatal one.
    }
  }

  return null;
}

export interface ConsentScanOptions {
  /**
   * How long to keep re-scanning for a banner that has not rendered yet.
   *
   * **Why this exists.** Measured on real sites: a CMP injects its banner *after*
   * `domcontentloaded` returns. Scanning a freshly loaded page once reports `{clicked:false}` on
   * the Guardian and CNN, and the same scan 4s later clicks the banner — so a single pass makes
   * the handler look correct while collecting nothing.
   *
   * Default 0 — one pass, which is what a caller that has already waited wants. The robot runner
   * passes a value because it knows it has just navigated.
   */
  waitMs?: number;
  /**
   * Polled between passes; a `true` return ends the wait immediately.
   *
   * The runner passes its kill switch here. Without it an abort still had to wait out the whole
   * `waitMs` on each page before the calling loop could notice, so "stop" on a 20-page run could
   * take minutes to take effect.
   */
  shouldStop?: () => boolean;
}

export async function acceptCookieConsent(
  page: Page,
  options: ConsentScanOptions = {}
): Promise<ConsentOutcome> {
  try {
    if (!page) {
      return { clicked: false };
    }

    const waitMs = Math.max(0, options.waitMs ?? 0);
    const deadline = Date.now() + waitMs;
    const POLL_INTERVAL_MS = 500;
    const shouldStop = options.shouldStop;

    // Each pass re-enumerates documents: a CMP frame does not exist yet on the first pass, so a
    // frame list captured once would keep missing it.
    for (;;) {
      // The budget covers the whole frame tree, not one document: a banner iframe is reached only
      // after the top document has been scanned, and measured pages carry ~500 visible controls
      // there. Sized from that measurement rather than from the inline-banner case.
      const budget: ConsentBudget = {
        deadline: Math.max(Date.now() + 2500, deadline),
        inspected: 0,
        maxCandidates: 60,
      };

      for (const document of consentDocuments(page)) {
        if (Date.now() >= budget.deadline || budget.inspected >= budget.maxCandidates) {
          break;
        }
        const outcome = await attemptConsentInDocument(document, budget);
        if (outcome) return outcome;
      }

      if (Date.now() >= deadline || shouldStop?.() === true) {
        return { clicked: false };
      }
      // Wait for the CMP to render, then look again.
      const { promise: settle, resolve: settled } = Promise.withResolvers<void>();
      setTimeout(settled, Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
      await settle;
    }
  } catch {
    // HARD REQUIREMENT: acceptCookieConsent never throws or rejects
    return { clicked: false };
  }
}
