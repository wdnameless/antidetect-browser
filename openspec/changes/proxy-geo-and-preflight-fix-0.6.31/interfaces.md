# Interfaces — proxy GEO and preflight FIX

## Changed contracts

```
GET /api/v1/proxy/list
  before: { proxy_id, type, host, port, username, country, timezone, status }
  after:  + city, latitude, longitude

GET  /api/v1/proxy/geo-fill/status   -> GeoFillStatus
POST /api/v1/proxy/geo-fill/start    -> GeoFillStatus
POST /api/v1/proxy/geo-fill/stop     -> GeoFillStatus

GeoFillStatus = { running, total, completed, succeeded, failed,
                  current_proxy_id, started_at, pacing_ms }
```

`proxies` gains a `city` column, added by the repository's existing `ensureColumn(db, table, column,
ddl)` helper. No other migration mechanism is used, and no existing column changes meaning.

## Renderer additions (no existing signature altered)

```ts
// preflight.ts
computePreflightFixPlan(verdict, profile?): PreflightFixPlan
applyPreflightFixes(profileId, plan): Promise<PreflightFixOutcome[]>
// PreflightFixItem carries either { autoFix } (with proposedValue) or { manualReason }.
```

## Unchanged (deliberately)

- The preflight detection logic itself. This changes only what can be done about a finding.
- `checkProxy`'s existing fields and the manual per-row check.
- The preflight route shapes (`run` / `last` / `start-with-preflight`).

## Ownership

| Area | Files |
| --- | --- |
| Geo storage, lookup, background pass, routes | `src/main/proxy/proxyManager.ts`, `src/main/api/routes/proxy.ts`, `src/main/db/schema.ts` |
| Fix plan and application | `src/renderer/src/preflight.ts` |
| Fix UI, Proxies table and toolbar, modal wiring | `src/renderer/src/components/PreflightModal.tsx`, `src/renderer/src/pages/Proxies.tsx`, `src/renderer/src/pages/Profiles.tsx` |
| `city` added to two ProxyRow constructions (build repair) | `src/main/api/routes/browser.ts`, `src/main/preflight/preflightService.ts` |
