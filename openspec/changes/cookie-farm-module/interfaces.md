# Interfaces — cookie-farm-module

Frozen signatures. Ownership zones are disjoint so slices can be built in parallel.

## Zone A — crawl core (`src/main/scripts/modules/cookieFarm/`)

Owner: slice A. Files: `sites.ts` (new), `consent.ts` (new).

```ts
/** A site worth visiting specifically because it sets durable cookies. */
export interface FarmSite {
  url: string;
  /** Grouping only — used for per-run category spread, never for behaviour. */
  category: 'search' | 'social' | 'commerce' | 'news' | 'media' | 'reference' | 'dev';
  /** Relative likelihood this site yields cookies. 1 = ordinary. */
  weight: number;
}

export const FARM_SITES: readonly FarmSite[];

/**
 * Deterministic sub-selection for one profile.
 * Same seed → same list, so a re-run warms the same way and two profiles differ.
 */
export function selectFarmSites(seed: number, count: number): FarmSite[];

/** Outcome of looking for a consent control on the current page. */
export interface ConsentOutcome {
  clicked: boolean;
  /** Text of the control that was clicked, for the report. */
  label?: string;
  /** How it was matched. */
  via?: 'selector' | 'text';
}

/**
 * Find and click a cookie-consent control, if the page shows one.
 * Never throws; returns `{clicked:false}` when nothing matched.
 */
export function acceptCookieConsent(page: Page): Promise<ConsentOutcome>;
```

## Zone B — runner (`src/main/scripts/modules/cookieRobot.ts`)

Owner: slice B. Frozen additions to the existing module:

```ts
export interface CookieRobotConfig {
  // ...existing fields unchanged...
  /** Accept cookie-consent banners. Default true. */
  acceptConsent?: boolean;
  /** Use the built-in curated list when `urls` is absent. Default true. */
  useBuiltInSites?: boolean;
  /** Fingerprint seed for deterministic site selection; taken from the profile. */
  seed?: number;
  /** Stop the run on the first challenge instead of continuing. Default false. */
  stopOnChallenge?: boolean;
}

export interface CookieRobotReport {
  // ...existing fields unchanged...
  /** Per-domain consent outcomes, for the operator panel. */
  consents?: Array<{ domain: string; clicked: boolean; label?: string }>;
  /** True when the run auto-started and closed the profile itself. */
  managedProfile?: boolean;
}
```

**Default supplier (closes R11).** `runCookieRobot` keeps its signature, but when
`customPageSupplier` is absent it MUST resolve the browser itself:

```ts
/**
 * Resolve a page from the profile's own browser.
 *
 * Starts the profile (headless per `opts`) when it is not running, and opens a DEDICATED tab for
 * the crawl — never `pages[0]`, which for a profile the operator already has open is their own
 * visible tab. `close()` reverses only what this call did: it closes that tab, disconnects, and
 * stops the profile only if this call started it.
 */
export function createProfilePageSupplier(
  profileId: string,
  opts: { headless: boolean }
): () => Promise<{ page: Page; close: () => Promise<void>; ownsProfile: boolean }>;
```

## Zone C — API (`src/main/api/routes/cookieRobot.ts`)

Owner: slice C. Frozen additions:

```ts
// POST /api/cookie-robot/run  (unchanged path)
// body: { profileId, urls?, ...CookieRobotConfig }
// NEW: urls becomes optional — the built-in list is used when absent.
// NEW response field: data.managedProfile  (true when the route started/stopped the profile)
// NEW: GET /api/cookie-robot/sites -> { code, msg, data: { sites: FarmSite[], count } }
```

`runCookieRobot` is called with the profile supplier from Zone B. The route MUST NOT start or
stop the profile itself — ownership of the lifecycle lives in the supplier.

## Zone D — UI (`src/renderer/src/`)

Owner: slice D. Files: `pages/Profiles.tsx`, `api.ts`, `i18n.tsx`, `icons.tsx`, `styles.css`.

```ts
// api.ts
export interface CookieFarmReport {
  id: string;
  pagesVisited: number;
  cookiesSet: number;
  domainsTouched: string[];
  errors: string[];
  durationMs: number;
  status: 'completed' | 'aborted' | 'error';
}
export function runCookieFarm(profileId: string): Promise<CookieFarmReport>;
```

- Action button in the Actions cell, `title={t('Warm up profile (cookie farm)')}`, disabled
  while `busy`.
- Result panel reuses the existing modal pattern; shows pages, cookies, domains, errors, and
  the per-domain consent list when present.
- RU keys added to `i18n.tsx`; missing keys fall back to the English literal.

## Do-not-touch (shared, read-only for every slice)

- `src/main/profiles/profileManager.ts` — frozen; `resolveLaunchConfig` already returns
  `headless`. If a slice needs a new field it goes through `LaunchConfig` review, not an edit.
- `src/main/launcher/chromium.ts` — `startProfile` / `stopProfile` only, no signature change.
- `src/main/db/schema.ts` — the `cookie_robot_reports` table already exists; `report_json`
  absorbs new fields, so **no migration is required**.

## Addendum (frozen after recon — measured constraints)

**M1 — `tsconfig.main.json` has `lib: ["ES2022","ES2024.Promise"]`, no DOM.** Zone A
(`consent.ts`) currently fails to compile (14 errors: `document`, `window`, `Element`,
`HTMLElement`, `HTMLInputElement`). Fix WITHOUT adding the DOM lib to the main tsconfig:
the DOM must only ever be touched inside page-context callbacks, and it MUST be reached as
`const doc = (globalThis as unknown as { document?: any }).document` / same for `window`.
`instanceof HTMLElement` is forbidden — it throws `ReferenceError` in Node tests; duck-type
instead (`typeof el.innerText === 'string'`).

**M2 — `urls` becomes optional.** `CookieRobotConfig.urls?: string[] | string`. Zone C's
existing test `cookieRobot.api.test.ts > returns 400 when profileId or urls is missing`
pins the OLD contract and MUST be updated: `{}` → 400, `{profileId}` → **200** (built-in
list), `{urls}` → 400.

**M3 — `managedProfile` is set by the runner, not the supplier.** `runCookieRobot` sets
`report.managedProfile = true` when it resolved the browser through the default supplier
(no `customPageSupplier` argument). No interface change to the supplier.

**M4 — no challenge detector exists in the repo** (grep `detectChallenge|isChallenge|captcha`
→ 0 hits outside the route's pass-through). Zone B adds a minimal inline check; do not build
a detector framework.

**M5 — report `consents` shape** is `Array<{ domain: string; clicked: boolean; label?: string }>`,
one entry per domain visited, whether or not a control was found.

## Addendum 2 (frozen after the post-delivery adversarial audit)

The first four contracts below were corrected by findings that were reproduced before being acted
on; each fix is proven by a probe in `.stealth-bench/`.

**A1 — M3 was wrong about ownership, and the supplier reports it.** `managedProfile` MUST be
`true` only when the run actually started AND stopped the profile. A profile the operator already
had open is warmed in place and left running, and claiming otherwise is a lie the operator acts on.
The supplier returns `ownsProfile` and the runner assigns it: `report.managedProfile =
supplied.ownsProfile`.

**A2 — the supplier MUST open its own tab.** `(await browser.pages())[0]` is the operator's visible
tab on an already-open profile; the crawl navigated it across every farm site and then closed it.

**A3 — a failure after `startProfile` MUST stop the profile.** If the supplier throws before
returning `close()`, the caller's `finally` has nothing to call, so the profile would be left
running headless with its user-data dir and proxy session held.

**A4 — an empty URL list means "use the built-in sites", not "visit nothing".** The scheduler
passes `urls: body.config?.urls || []`, so an omitted `urls` arrived as `[]` and produced a
zero-page run that reported `completed`.

**A5 — non-finite numeric config MUST fall back to the default.** `Number(null)` is `0` and
`Number('abc')` is `NaN`; `??` preserves both, and `report.pagesVisited < NaN` is false, so the
loop exited before the first page and still reported success.

**A6 — the consent wait MUST poll the kill switch.** `acceptCookieConsent` takes
`shouldStop?: () => boolean`; without it a `stop` on a 20-page run took minutes to take effect.

**A7 — BOTH `activeRuns` keys MUST be deleted when a run finishes.** The entry is registered under
`runId` and `profileId`; deleting only the `runId` left a completed run abortable by profile id.

## Contracts every slice must honour

1. **Fail closed on challenges** — a CAPTCHA or anti-bot page is recorded in `errors`, never
   bypassed (R17).
2. **No authentication** — no form submission, no credential use (R16).
3. **Determinism** — `selectFarmSites` is a pure function of `(seed, count)`.
4. **No profile mutation** — warming never writes proxy or fingerprint config (R18).
