## 1. Reported defects

- [x] 1.1 Language: the select offered 7 options against a catalog that derives 21; a `<select>` whose value matches no option renders its first option, so a profile holding `es-MX`/`en-CA`/`zh-CN`/… showed "Auto" and Save wrote that empty value over the real language. Options now come from `GET /api/v1/browser-profile/languages` (catalog-derived) and always include the profile's own value.
- [x] 1.2 Group: `openCreateModal` reset `groupId` to `''` regardless of the active filter, so a profile created while viewing a group was stored ungrouped. It now seeds `selectedGroupFilter`.
- [x] 1.3 Prove 1.1 and 1.2 end to end, and red-check both guards by reverting.

## 2. Bug hunt

- [x] 2.1 Run four read-only scouts over disjoint slices: profile persistence, proxy/geo, renderer state, API contracts.
- [x] 2.2 Re-derive every claim by measurement before accepting it (1 refuted, 3 deferred, 7 confirmed).
- [x] 2.3 Fix the confirmed defects: rename wiping the pinned phone model; rename wiping group bookmarks; binding an extension unbinding the others; "randomize" producing a preflight-failing fingerprint; the timezone select sharing the language select's class of defect; a stale `Cargo.toml` disabling the updater's downgrade guard.
- [x] 2.4 Add a guard per fix and red-check each by reverting the fix.

## 3. Release

- [x] 3.1 Fold the never-tagged 0.6.43 into 0.6.44 so the changelog does not list a release that never existed.
- [x] 3.2 Sync the version across `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the `Cargo.lock` entry; add the test that enforces it.
- [x] 3.3 Run the three commands CI runs: `npm run typecheck`, `npm run build`, `npm test`.
- [x] 3.4 Blind acceptance against the operator's brief only.
- [ ] 3.5 Commit, push, tag `v0.6.44`, and let CI publish — **awaiting the operator's decision** on branch strategy and on burning the tag via CI vs a local build.
