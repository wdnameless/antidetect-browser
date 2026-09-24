# Recon — headless toggle + geo in the profiles table

## Requested
> «В настройках профиля я хочу чтобы можно было включать и выключать headless режим. И чтобы в
> таблице с прокси отображалось гео, а не протокол»

## What already existed (reuse > create)

| Thing | Where | Reused as |
|---|---|---|
| `flagOf()` — ISO code → flag emoji | private in `pages/Proxies.tsx` | extracted to `renderer/src/proxyGeo.ts`, now shared |
| geo cell showing `flag country · city · timezone` | `pages/Proxies.tsx` "Location" column | the exact pattern ported into the profiles table |
| `headless` column (1/0/NULL) + API field + launcher support | `db/schema.ts`, `profileManager.ts`, `chromium.ts` | the toggle is a UI for a mechanism that already worked |
| `proxies.country/city/timezone` resolved by the health check | `proxy/proxyHealth.ts` → `proxyManager.updateProxy` | the geo the column displays — never invented |

Deliberately NOT added: a column, a migration, or a proxy-geo lookup. All three existed.

## Changes

**Headless toggle** (`src/renderer/src/pages/Profiles.tsx`, PRIVACY section)
- `headlessMode` state; loaded from `d.headless`; sent on both create and update payloads.
- Checkbox `data-testid="headless-mode"`, labelled, with a hint that it is for agent profiles.
- Server: `getProfileDetails` did **not** return `headless`, so the editor could not show the
  stored value. Added to the `ProfileDetails` interface and the detail response, normalised
  (`p.headless === 1`) so the tri-state column cannot reach a checkbox raw.

**Geo in the proxy column** (`Profiles.tsx`, plus `profileManager.ts` + `api.ts`)
- The cell led with a protocol badge; it now leads with `🇩🇪 DE · Berlin` and moves the transport
  into the tooltip.
- `listProfiles` now selects `px.city` alongside `px.country` (`proxy_city`), since country alone
  is a coarser answer than the Proxies page already gives.
- Fallback is deliberate: a proxy with no resolved geo shows its transport name rather than a
  blank or an invented location.

## Acceptance check

- `tests/unit/proxyGeo.test.ts` — 6 cases covering flag derivation, a country NAME (not a code),
  country+city, city alone, timezone fallback, and the empty case the transport-fallback depends on.
- Full suite: 156 files / 1300 passed; both typechecks clean.
- Rendering, on a source-run service against the scratch workspace:
  - row rendered `oracle-c5-check … 🇩🇪 DE · Berlin 127.0.0.1:1080 Closed` — geo present, no protocol
    (`.stealth-bench/geo-column.png`); rows whose proxies have no geo still showed `HTTP host:port`.
  - editor rendered the control checked=false, visible, labelled
    `Headless — launch without a window` (`.stealth-bench/headless-toggle.png`).
  - **toggle OFF → launched process had no `--headless`; toggle ON → `--headless=new`.** The
    checkbox changes what the kernel actually does, not just what the form stores.

## Note on verifying geo
`getProfileDetails`/`listProfiles` read the database the service loads **at startup** and persist by
rewriting the whole file (`db/index.ts`: `<DB_PATH>.tmp` renamed over the target). Editing the file
underneath a running service therefore does not change what the API serves, and a fake proxy has its
geo overwritten by the health check on the next probe. Seeding requires writing the file with the
service stopped — worth knowing before chasing a "geo does not persist" ghost.
