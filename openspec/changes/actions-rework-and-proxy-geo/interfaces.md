# Interfaces — boundaries, signatures, owners

## The rule about what each layer owns

The geo value is written by exactly one layer and read by several, and each read is from a different
moment in time. That distinction is the whole design; collapsing it is what produced two of the
defects.

| Layer | File | Owns | Does NOT own |
|---|---|---|---|
| Proxy store | `src/main/proxy/proxyManager.ts` | The lookup, the ISO code's normalisation, the queue, persistence to `proxies` | Any display decision |
| Profile store | `src/main/profiles/profileManager.ts` | Binding a proxy to a profile, then queueing a check | The lookup itself |
| Report | `src/main/scripts/modules/cookieRobot.ts` | `exitGeo` captured **at run time** | The live profile value |
| Render | `src/renderer/src/proxyGeo.ts` | Turning a code + name into a flag and label | Where the value came from |
| Consent | `src/main/scripts/modules/cookieFarm/consent.ts` | Deciding whether a control is an accept action | Clicking it, or the site list |
| Sites | `src/main/scripts/modules/cookieFarm/sites.ts` | The pool and its weighting | Fetching anything |

## Signatures

```ts
// proxyManager.ts — the only writer of a resolved country.
export interface ProxyCheckResult {
  ok: boolean; ip?: string;
  country?: string;        // provider display name, e.g. "Germany"
  countryCode?: string;    // ISO 3166-1 alpha-2 — the value the flag is derived from
  city?: string; timezone?: string; latitude?: number; longitude?: number;
  latencyMs?: number; error?: string;
}
export async function checkProxy(proxy: ProxyRow): Promise<ProxyCheckResult>;
export function queueGeoChecks(ids: readonly string[]): void;   // idempotent; skips a resolved row
export function createProxy(input: ProxyInput): string;         // queues on create

// profileManager.ts — every door that binds a proxy ends here, so the queue is reached from one place.
//   createProfile   -> queueGeoChecks([proxyId])  after the INSERT (worker must find the row)
//   updateProfile   -> queueGeoChecks([effectiveProxyId])

// cookieRobot.ts — the report is a record of a PAST run, so it stores what was true then.
export interface CookieRobotReport {
  cookiesSet: number;   // whole session, not one origin
  exitGeo?: { code: string | null; country: string | null } | null;  // resolved at create time
}

// proxyGeo.ts — the ONLY place a flag is derived.
export function flagOf(countryCode: string | null | undefined): string;  // '' unless /^[A-Z]{2}$/
export function geoLabel(parts: { code?: string | null; country?: string | null;
                                  city?: string | null; timezone?: string | null }): string;

// consent.ts — one rule, two evaluation contexts.
export function matchesConsentVerb(text: string): boolean;              // runs in Node
export function evaluateTextConsent(verbs: string[], denylist: string[],
                                    maxCandidates: number,
                                    forbiddenFragments: string[]): { clicked: boolean; label?: string };
export const FORBIDDEN_CONSENT_FRAGMENTS: readonly string[];
```

## Two boundaries worth stating explicitly

**`evaluateTextConsent` is serialized into Chromium by Puppeteer, so it cannot close over module
scope.** The forbidden-fragment list is therefore a *parameter*, not a shared constant, and it has no
default — an omitted argument would silently drop the refusal protection. This is deliberate: the rule
was duplicated across the two contexts once, the prefix match was added to one copy and not the other,
and the unit tests would then have described behaviour real runs did not have. A divergence test pins
them together.

**`resolveExitGeo` reads a JOIN against the current profile row, and is not exported.** The modal must
not re-derive the country at render time: the operator can re-check or replace a proxy after a run, and
the report would then be re-labelled with a country the traffic never had.

## Ownership

Single author for this change. `src/main/scripts/modules/cookieFarm/*` and `cookieRobot.ts` were
touched only by this work; no concurrent writer.

## What is deliberately absent

- No name-to-code mapping table. `ip-api` returns `countryCode` in the same response as `country`, so
  the code is asked for rather than derived — and the name is never parsed into a code, which is why
  `flagOf("Germany")` returns `''` instead of a broken glyph.
- No retry loop for a failed lookup. A `status='fail'` row is excluded from backfill on purpose, and
  the operator re-checks deliberately. `ponytail: no auto-retry on fail; add backoff when a genuine
  transient outage is observed rather than assumed.`
