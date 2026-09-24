# Recon — bug hunt across the geo/preflight/profile/renderer seams, and the release

## Requested
> «Поищи баги, фикси и делай релиз»

## Method
Three independent read-only reviewers over disjoint slices (proxy/geo, profile lifecycle,
renderer), plus a manual pass over migrations and the queue. Every reported finding was
**re-derived before being accepted** — two were rejected as not-reproducible, one was found to be
a test-fixture defect rather than a product defect, and one guard test was verified to actually
fail without its fix.

## Fixed (9 defects)

| # | Defect | Evidence |
|---|---|---|
| 1 | **Preflight threw away the check it paid for.** `runPreflight` probes through the proxy, gets country + ISO code, and stored nothing — so the standard pre-launch action left the column reading "Not checked yet". | `preflightService.ts` probe result was a local; now `recordCheckResult` |
| 2 | **Manual Test did not push its result.** `/api/v1/proxy/check` wrote the columns without the `proxy-geo` event, so the row the operator was watching stayed stale until the 30 s poll. | `routes/proxy.ts` wrote via `setProxyResult` |
| 3 | **`profile.color` never reached the UI.** `listProfiles` SELECTed `p.color` and `ProfileListItem` typed it, but the mapping omitted it — the badge dot could not render for any profile. Pre-existing since the badge feature (blame: `bd954a6`). | mapping object literal had no `color` key |
| 4 | **`batch-bind-proxy` never queued geo.** One of the six creation doors still unchecked: proxies attached by a batch stayed unchecked. | `routes/batch.ts` UPDATE with no `queueGeoChecks` |
| 5 | **Queue released an id while its request was in flight.** A re-queue in that window checked the same proxy twice against a rate-limited quota and double-counted it. | `geoPendingSet.delete` ran at shift, not at completion |
| 6 | **`running` stayed false while a live worker drained.** After a stop, newly accepted work drained while every status query said "not running". | `if (geoWorkerActive)` branch never set `running` |
| 7 | **A stopped pass reported itself finished.** `total` was rewritten to `completed` in `finally`, so 3-of-100 cancelled read as "3/3". | `finally` block |
| 8 | **Proxies page polled with a stale closure and churned its interval.** `geoFill?.running` was read from the effect's frozen scope AND listed as a dependency, so the effect relied on re-subscribing to observe its own state. | `Proxies.tsx` effect deps `[load, geoFill?.running]` |
| 9 | **Profile modal's proxy dropdown kept stale geo.** The `proxy-geo` handler refreshed the table but not `loadProxies()`, which feeds the "Choose Proxy from List" dropdown. | `Profiles.tsx` SSE handler |

### Rejected after verification
- "`checkProxy` can double-store" — the two-attempt loop returns on the first parsed answer;
  no path stores twice.
- "`country_code` can store a non-ISO value" — `normalizeCountryCode` rejects anything not
  `^[A-Z]{2}$`, and the column is only written through it.

## Fixed test defects (2)

| Defect | Why it mattered |
|---|---|
| `udpRelay.test.ts` asserted hardcoded port **59999** was closed. 59999 is inside the Windows ephemeral range, so a sibling suite binding port 0 can be handed that number. | Reproduced by binding 59999 and watching the assertion flip. This is what broke the full suite once `geoQueue` started binding ephemeral ports. The test now takes a proven-closed port. |
| `geoQueue.test.ts` awaited the object returned by `Promise.withResolvers()` — not a thenable, so awaiting it is a no-op. The fixture ran before `listen` fired, read the port as 0, and connected to an unbound port (EADDRNOTAVAIL, then an OOM from an unbounded retry helper). | Measured: inside the listening callback `address()` is `{port: 61042}`; one microtask later `listening=false address=null`. |

The duplicate-check guard was verified as a real guard: with the fix reverted and the stub made
slow-and-failing, it fails `expected 2 to be 1`; it had to be made slow-and-failing deliberately,
because with an instant success answer the row is already resolved and the duplicate is skipped —
so the first version of the test proved nothing.

## Acceptance
- Full suite: **159/159 files, 1335 passed, 12 skipped, 0 errors.**
- Both typechecks clean.
- Legacy-database migration proven: a `proxies` table created WITHOUT `country_code` gains it
  through the real `migrate()` path, and the `listProfiles` query that names the column then runs.
