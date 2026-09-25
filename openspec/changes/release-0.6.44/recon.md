# Recon — bug hunt + release 0.6.44

## Method

Four read-only scouts over disjoint slices — profile persistence, proxy/geo, renderer state, API
contracts — each told to prove claims by code path and to report nothing speculative. **Every claim
was re-derived here before being accepted**, which is what separated the real defects from the noise:

- 7 confirmed and fixed (R4–R9 in the manifest),
- 3 deferred with reasons (R10–R12),
- **1 refuted**: "`toInput` turns an omitted proxy port into NaN and corrupts the row" — `port` is
  required by `proxySchema`, so the omission the claim depends on cannot reach that function.

## Defects fixed, each proven by measurement

| Defect | The measurement |
|---|---|
| Rename wiped a pinned phone model | created with `pixel-7` → `null` after a rename, because `getProfileDetails` never sent the field |
| Rename wiped group bookmarks | 1 bookmark → `[]`, because the form passed its always-empty state |
| Binding extension B unbound A | `["ext_a"]` → `["ext_b"]`, because `bindExtensions` replaces the set |
| "Randomize" produced a preflight failure | new seed selected `win-intel-uhd-620-laptop`, config still said `win-intel-iris-plus-g4-laptop`, coherence rejected on screen resolution |
| Timezone select could wipe a zone | a zone from proxy geo can never match a 7-item list |
| Stale `Cargo.toml` disabled the updater's downgrade guard | 0.6.42 compiled as "installed" while the app reported 0.6.44, so a 0.6.43 "update" would have passed; comparator behaviour proved by compiling it |

The last one is the reason this was worth hunting before a release rather than after: nothing in the
build would have failed, and the version the operator sees would have looked correct.

## Two defects of one shape

`mobile_model_id` and the browser language share a root: **a value the API does not return is a value
a form will overwrite.** The modal reads what it is given, shows a fallback for what is missing, and
sends the fallback back. Both fixes are therefore the same rule applied twice — return what the form
edits, and never let a control be unable to represent a value the API can store. That rule is what
the new guards assert, rather than asserting a function was called.

## Evidence hygiene

- Live databases were opened **read-only**.
- The earlier write incident (probe scripts resolving to the default data root) was restored from
  that run's auto-backup and is recorded in `openspec/changes/language-and-group-create/recon.md`.
  Every probe after it set `ANTIDETECT_DATA_DIR` to a throwaway directory.
- All probe files and throwaway data roots were removed from the working tree.

## Acceptance

- Guards **red-checked**: each fix reverted individually, the matching test fails, then restored and
  passing. The revert was confirmed to have applied before the run was trusted.
- `npm run typecheck`, `npm run build` (the same three commands CI runs) — exit 0.
- Full suite: **161 files, 1351 passed, 12 skipped, 0 failed.**
- Blind acceptance: see `oracle.md`.
