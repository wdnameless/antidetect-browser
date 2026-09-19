# Tasks

## 1. Profiles table adapts to the window (R01)

- [ ] 1.1 `.table-container` scrolls horizontally instead of hiding overflow; add the pinned-column CSS and a `--table-actions-w` token
- [ ] 1.2 Profiles table: make the header cells' percentage widths a `min-width` layout so columns do not shrink below readability, and pin the Actions cell
- [ ] 1.3 Test: at three viewport widths every action button's right edge is inside the container box

## 2. Transfer carries names, sessions and everything else (R02, R03)

- [ ] 2.1 `profiles` rows: replace `INSERT OR IGNORE` with an upsert that updates a colliding id from the source, and count `updated` separately from `created`/`skipped`
- [ ] 2.2 Carry dependent rows keyed by profile id: `profile_extensions`, `profile_tags`
- [ ] 2.3 Verify the workspace copy by reading the destination back (cookies file present and non-empty), not by counting `cpSync` calls; report `workspaces_verified`
- [ ] 2.4 Tests: stale-name update; dependent rows carried; a tampered source row that the destination refuses still errors rather than reporting success
- [ ] 2.5 UI: surface `updated` in the Settings transfer result line

## 3. Stealth signing key survives a restart (R05, R06)

- [ ] 3.1 Persist the stealth key pair through `secretStore` under the data folder; load it on first use, generate only when absent
- [ ] 3.2 On verification failure, re-sign from our own generator and re-verify; abort only when re-generation also fails. Log the transition at info, the abort at error
- [ ] 3.3 Tests: sign in one process / verify in another; a tampered `stealth.js` is still refused as `digest-mismatch`
- [ ] 3.4 Confirm the key is not written in plaintext anywhere and is absent from logs

## 4. Tray quit closes every open profile (R07, R08)

- [ ] 4.1 The quit path stops all profiles and waits for them before exiting
- [ ] 4.2 Bound the wait; on timeout force-kill the profile's tree and name the profile in the log
- [ ] 4.3 Tests: stop-all is called on the quit path; a stop failure still exits and reports the id

## 5. Verification

- [ ] 5.1 `npm run typecheck` clean; `npx vitest run` full; `cargo test`
- [ ] 5.2 Live: transfer a real folder and confirm names + a login session arrive
- [ ] 5.3 Live: launch two profiles, tray-quit, confirm zero Chromium processes remain
- [ ] 5.4 Live: table at 900/1100/1400px — Actions reachable at all three
