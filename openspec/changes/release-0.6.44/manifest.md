# Manifest — release 0.6.44

Every row quotes the operator's own words. `R##` rows are the contract this change is judged
against; the "Found in the hunt" rows are scope the hunt itself produced.

## Requested

| # | Requirement (verbatim) | Status | Evidence |
|---|---|---|---|
| R1 | «Язык не менятся, хотя ставлю язык браузера EN-US.» | Met | The select offered 7 options against a catalog that derives 21; a `<select>` whose value matches no option renders its FIRST option, so a profile holding `es-MX`/`en-CA`/`zh-CN`/… displayed "Auto" and Save wrote that empty value over the real language. Options now come from `GET /api/v1/browser-profile/languages` (derived from the catalog) and always include the profile's own value. Measured live: 15/74 profiles held an unrepresentable locale. Round-trip proven for all 21 locales. |
| R2 | «если создаешь профиль внутри группы то он сразу должен создаваться в определнной группе, сейчас создается просто во вкладке ALL» | Met | `openCreateModal` reset `groupId` to `''` regardless of the active filter. Now seeds `selectedGroupFilter`. End-to-end: stored `"g_fb_ok"` and visible under that group filter; the old behaviour proven to store `null` and be invisible there. |
| R3 | «ищи баги и собирай релиз» | Met (hunt) / see below (release) | 4 read-only scouts over disjoint slices (profile persistence, proxy/geo, renderer state, API contracts). Every claim re-derived before acceptance — 1 refuted, 3 deferred with reasons, 7 confirmed and fixed. Blind acceptance run against this brief. |

## Found in the hunt and fixed

| # | Defect | Proof it was real |
|---|---|---|
| R4 | Renaming a profile destroyed its pinned Android phone model | `getProfileDetails` omitted `mobile_model_id` → modal read `undefined` → Save sent `null`. Measured: `pixel-7` → `null` after a rename. Field returned, typed on both sides, the hiding `as any` removed. |
| R5 | Renaming a group deleted its bookmarks | Form passed `editBookmarks` (always `[]`) to `updateGroup`, which writes anything not `undefined`. Measured: one bookmark → `[]` after rename. |
| R6 | Binding a second extension unbound the first | `bindExtensions` replaces the whole set; page sent only the clicked id. Measured: A then B left `["ext_b"]`. |
| R7 | "Randomize fingerprint" produced a preflight-failing profile | Seed updated, `config_json` left describing the old draw. Measured: new seed → `win-intel-uhd-620-laptop`, config still `win-intel-iris-plus-g4-laptop`, coherence rejected on screen resolution. |
| R8 | Timezone select could wipe a zone | Same class as R1, wider set: a zone from proxy geo can never be in a 7-item list. |
| R9 | A stale `Cargo.toml` disabled the updater's downgrade guard | `updater.rs` uses `CARGO_PKG_VERSION` as the installed version; it read 0.6.42 while the app reported 0.6.44, so a 0.6.43 "update" would have been accepted. Compiled proof of the comparator. Nothing enforced the match; a test does now. |

## Known issues — deliberately not fixed

| # | Defect | Why deferred |
|---|---|---|
| R10 | `COUNTRY_TO_LANG` writes bare codes (`en`), which the modal cannot represent | Fixing it changes what the preflight Fix button writes — its own change. |
| R11 | `/status` registered before `rateLimitMiddleware`, so its 50 req/s limit never applies | Handler returns a constant; negligible impact. Recorded rather than reordering routes inside a release. |
| R12 | `duplicateProfile` / bundle export-import carry a subset of profile fields | Needs a product decision on which fields a clone should inherit. |

## Refuted during triage

| Claim | Why it is not a defect |
|---|---|
| `toInput` turns an omitted proxy port into `NaN`, corrupting the row | `port: z.union([z.number(), z.string()])` is **required** by `proxySchema`, so the omission the claim depends on cannot reach `toInput`. |

## Acceptance

- Guards **red-checked** for every fix: reverted → the new test fails; restored → passes. Verified the
  revert actually applied before trusting the run.
- Full suite: **161 files, 1351 passed, 12 skipped, 0 failed.** `npm run typecheck` and `npm run
  build` (the same three commands CI runs) both exit 0.
- Live-database evidence was read-only. The one write incident earlier in the session (probe scripts
  resolving to the default data root) was restored from that run's auto-backup and is recorded in
  the previous recon; no probe in this task wrote outside `ANTIDETECT_DATA_DIR`.
