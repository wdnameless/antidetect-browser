# Recon — «почему гео не отображается proxy not checked yet»

## Reported
> «почему гео не отображается proxy not checked yet, если профиль создается с прокси то он сразу
> должен чекаться, запоминаться и показывать флаг страны и две буквы страны по типу DE, US, FR»

## Root cause (reproduced, not inferred)

`queueGeoChecks` was called **only inside the inline-proxy branch** of `createProfile`/`updateProfile`.
A proxy chosen from the saved list arrives as `proxy_id` and never enters that branch, so nothing ever
asked where it exits. That is the normal UI flow — the create modal's `proxyMode === 'saved'` path
sends `proxy_id`, `proxyMode === 'custom'` sends `proxy`.

Both branches were then verified by direct experiment: with the fix reverted, the two new guards fail
by timing out with `status` still `'unknown'`; with it, both pass.

Two further facts were checked and **rejected as the cause**, rather than assumed:
- *Stale build.* The installed `nulltrace.exe` is 0.6.39 while the repo is 0.6.43, which looks like the
  answer. It is not the reported defect: `dist/main` has no `country_code` at all, so this build
  predates the whole geo feature — the screenshot shows the geo column and the `#FB-OK` tag, so the
  running instance is newer than that. A `strings`-based check of the exe returned 0 for every marker
  including unrelated ones, so it was discarded as a non-working probe instead of being cited.
- *Missing `country_code` column.* `D:/nt-farm/antidetect.db` genuinely lacks it. It is a test-farm DB
  (profiles named `guard-missing-proxy`, `badge-status-probe`, `x_00000000-dead-beef-...`), not the
  instance in the screenshot, and the real `migrate()` path adds the column — already covered by the
  existing backfill test.

Also fixed while here, because the report asked for the letter code explicitly and the column did not
show it: `geoLabel` rendered `🇩🇪 Germany · Falkenstein` and never printed `DE`.

## Files touched
| File | Change |
|---|---|
| `src/main/profiles/profileManager.ts` | Queue the geo check for **every** bound proxy (create + update) |
| `src/renderer/src/proxyGeo.ts` | Print the two-letter code next to the flag |
| `src/main/proxy/proxyTransport.ts` | New: one transport builder shared by both checks |
| `src/main/proxy/proxyManager.ts`, `proxyHealth.ts` | Use it; delete dead 12-symbol re-export |
| `tests/unit/proxy/geoQueue.test.ts` | Guards for saved-proxy create + update |
| `tests/unit/proxyGeo.test.ts` | Pin code rendering, lowercase, malformed |
| `CHANGELOG.md`, `docs/API_CONTRACT.md`, version 0.6.43 | Docs |

## Acceptance (all executed)
- Guards red-checked: reverted the fix → both new cases fail; restored → pass. 11/11 in the file.
- `tests/unit/proxyGeo.test.ts`: renders `🇩🇪 DE · Germany · Berlin`, `🇺🇸 US · …`, `🇫🇷 FR · …`.
- Full suite: **159/159 files, 1340 passed, 12 skipped, 0 failed.**
- `typecheck:main` and `typecheck:renderer`: both clean.
- pi-lens on all changed paths: clean. The 3 remaining findings in `src/main/proxy` are pre-existing in
  two files this change does not touch (`cookieInjector.ts`, `stealthInjection.ts`).
