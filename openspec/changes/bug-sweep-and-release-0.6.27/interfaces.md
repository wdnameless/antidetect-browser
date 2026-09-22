# Interfaces — bug sweep + release 0.6.27

The sweep changed behaviour, not contracts. Two signatures moved, both internal.

## Changed

```ts
// src/main/scripts/modules/cookieRobot.ts
// BEFORE: () => Promise<{ page: Page; close: () => Promise<void> }>
export function createProfilePageSupplier(
  profileId: string,
  opts: { headless: boolean }
): () => Promise<{ page: Page; close: () => Promise<void>; ownsProfile: boolean }>;
```

`ownsProfile` exists so the report cannot claim lifecycle ownership the run did not have. Only
`runCookieRobot` consumes it.

```ts
// src/main/scripts/modules/cookieFarm/consent.ts
export interface ConsentScanOptions {
  waitMs?: number;
  /** Polled between passes; a `true` return ends the wait immediately. */
  shouldStop?: () => boolean;
}
export function acceptCookieConsent(page: Page, options?: ConsentScanOptions): Promise<ConsentOutcome>;
```

`shouldStop` is how the runner's kill switch reaches the polling loop.

## Unchanged (deliberately)

- `POST /api/cookie-robot/run` request and response shapes. The fixes are behavioural: the same
  request that used to visit zero pages now visits pages; the same request against an open profile
  now leaves that profile's tabs alone.
- `CookieRobotReport` fields — `managedProfile` keeps its name and type, and now means what its
  comment always said.
- `cookie_robot_reports` schema — no migration. Reports persist through `report_json`.

## Ownership of the fixes

| Area | File |
| --- | --- |
| Supplier lifecycle, boundary validation, abort key, ownership reporting | `src/main/scripts/modules/cookieRobot.ts` |
| Abort-aware consent wait | `src/main/scripts/modules/cookieFarm/consent.ts` |
| Modal dismiss during a long run | `src/renderer/src/pages/Profiles.tsx` |
| Machine SID lookup | `src/main/extensions/securePreferences.ts` |
| Release-gating flaky test | `tests/unit/mcpBundle.test.ts` |
