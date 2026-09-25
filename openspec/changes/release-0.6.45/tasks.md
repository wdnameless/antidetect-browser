## 1. The three deferred defects

- [x] 1.1 Preflight Fix proposes full locales only, each one a locale the fingerprint catalog derives.
- [x] 1.2 `/status` applies the rate limit it declares, without moving the health check behind auth.
- [x] 1.3 Duplicating a profile carries its configuration (`notes` deliberately excluded).
- [x] 1.4 Bundle export/import carries the same configuration; fields optional so older bundles import.
- [x] 1.5 One shared `operatorConfigColumns` mapper, so the detail payload, the clone and the bundle cannot drift.
- [x] 1.6 Guard each fix and red-check it by reverting.

## 2. The updater key rotation

- [x] 2.1 Establish what actually happened: v0.6.42's published installer verifies against its own shipped key, and its CI signed successfully — so the rotation in 0.6.44 was unnecessary.
- [x] 2.2 Confirm the old key's password is unrecoverable (not in shell history, not in any file, overwritten in the secrets by me).
- [x] 2.3 Confirm the mechanism of the breakage: `tauri-plugin-updater` verifies the artifact signature only in `download()`, against the pubkey compiled into the running build.
- [x] 2.4 Record the shipping key identity in `resources/release-key-identity.json`, with the retired key kept.
- [x] 2.5 Guard it: a test fails if the pubkey changes without updating that record (red-checked by swapping the key back).
- [x] 2.6 Correct `docs/RELEASE.md`, which is what misled me, and state that changing the signing key is a breaking event.

## 3. Release

- [x] 3.1 Bump all four version carriers to 0.6.45 (the test added in 0.6.44 enforces the match).
- [x] 3.2 Run the three commands CI runs: `npm run typecheck`, `npm run build`, `npm test` — 163 files, 1362 passed, 0 failed.
- [x] 3.3 Record the incident honestly in the changelog and in this change, including the required manual reinstall.
- [ ] 3.4 Commit, push, tag `v0.6.45`; verify the published `latest.json` and signature.
- [ ] 3.5 Reinstall 0.6.45 manually once (required by the key change), then confirm in-app updating works for 0.6.46 onward.
