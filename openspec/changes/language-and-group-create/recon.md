# Recon — «язык не меняется» and «профиль создаётся во вкладке ALL»

## Reported
> «Язык не менятся, хотя ставлю язык браузера EN-US.»
> «Так же если создаешь профиль внутри группы то он сразу должен создаваться в определнной группе,
> сейчас создается просто во вкладке ALL.»

## INCIDENT — I damaged a data file. Restored.
Probe scripts called `initDb()`, which resolved to the **default** data root
(`C:/Users/Administrator/.antidetect/data/`), not the app's. Their cleanup (`DELETE FROM profiles`)
wiped 3 rows there. The same run had auto-created `backups/antidetect-2026-09-25-04-39-18.936.db`;
I restored from it and verified: 3 profiles, 3 fingerprints, 1 proxy. No other root was written to —
`D:/NULLTRACE` and `D:/nt-farm` were only ever opened read-only. Every probe after that incident set
`ANTIDETECT_DATA_DIR` to a throwaway directory, verified to report `profiles in scope: 0`.

## Defect 1 — a stored language was silently destroyed by opening the profile

**Root cause.** The language `<select>` held **seven** hand-written options; the fingerprint catalog
derives **twenty-one** locales. A `<select>` whose `value` matches no `<option>` renders its FIRST
option, so a profile holding `es-MX` opened showing "Auto" (empty). `saveFingerprintConfig` writes
`profileLang` **unconditionally**, so pressing Save put that empty string back over the real
language; the launcher then emitted no `--lang`/`--accept-lang` and the browser used the machine
locale. That is exactly "язык не меняется".

**Measured on real databases** (read-only): 15 of 74 profiles in `D:/nt-farm`, 1 of 18 in
`D:/NULLTRACE` held a locale the select could not display — every one of them was destructible just
by opening and saving it.

**Fix.** The list is served by `GET /api/v1/browser-profile/languages`, derived from the same
`localePool`s that assign the language, so UI and catalog cannot drift again. The select also always
includes the profile's own value, so a locale from an import / older build / hand-edited DB stays
representable instead of collapsing to "Auto".

**Ruled out** (measured, not assumed): the kernel applies `--lang` and `--accept-lang` correctly —
verified on the real `chrome.dll` build (148.0.7778.215) by four separate probes: fresh profile,
**relaunch with a changed language**, `navigator.languages`, the UI locale via `chrome://settings`,
and the real `Accept-Language` HTTP header. All followed the flag. The flags are also emitted
correctly by `buildChromiumArgs` for the stored config. The loss was upstream of launch.

## Defect 2 — a profile created inside a group landed in ALL

**Root cause.** `openCreateModal` reset `groupId` to `''` regardless of the active filter, and
`saveProfileModal` sends `group_id: groupId || undefined`. Creating while filtered to a group stored
the profile ungrouped, and it immediately disappeared from the list the operator was standing in.

**Fix.** The create form starts on `selectedGroupFilter` (the group being viewed). The Group
Assignment select still overrides it; with no filter the value is simply empty.

## Known issue left open (deliberate)
`COUNTRY_TO_LANG` in `src/renderer/src/preflight.ts` maps to **bare** codes (`US: 'en'`) while every
profile stores a full locale (`en-US`). Values written by the preflight Fix are therefore not
selectable in the modal and are subject to the same wipe. Fixing it changes what the Fix button
writes, so it is recorded in the changelog rather than folded into this change.

## Files touched
| File | Change |
|---|---|
| `src/main/api/routes/browser.ts` | `GET /api/v1/browser-profile/languages`, derived from the catalog |
| `src/renderer/src/api.ts` | `browserLanguages()` client |
| `src/renderer/src/pages/Profiles.tsx` | options from the API + own value; create seeds the group |
| `tests/unit/profileLanguage.test.ts` | guards for both defects (source-level) |
| `tests/unit/profileLanguagesEndpoint.test.ts` | endpoint ≡ catalog, and covers the omitted locales |
| `CHANGELOG.md`, `docs/API_CONTRACT.md`, version 0.6.44 | docs |

## Acceptance (all executed)
- Guards **red-checked**: with both fixes reverted the two new guards fail (`expected false to be
  true`); restored, they pass. The revert was verified to have actually applied before the run.
- Endpoint guard: served list `toEqual` the catalog-derived list; asserts the previously-omitted
  locales (`es-MX`, `en-CA`, `en-AU`, `zh-CN`, `ja-JP`, `pl-PL`, `id-ID`, `nl-NL`) are present.
- Behavioural: fetched the endpoint and ran the real select logic + launcher — **21/21 locales**
  render their true value and emit `--accept-lang=<locale>`.
- Group: end-to-end create + list — stored `"g_fb_ok"`, visible in the group filter; the old
  behaviour (no group) verified to store `null` and be invisible in that group.
- Full suite: **160/160 files, 1344 passed, 12 skipped, 0 failed.** Both typechecks clean.
- No probe scripts, throwaway roots or temp files left in the tree.
