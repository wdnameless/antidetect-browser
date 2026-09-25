# release-0.6.45

## Why

> «Пофикси все сам чтобы я мог обновиться через приложение»

Two things: close the three defects 0.6.44 deliberately left open, and make in-app updating work
for the operator.

## What changed

See `manifest.md` for the requirement rows, `interfaces.md` for the touched boundaries and
signatures, `recon.md` for the method, the measurements, and the full account of the incident below.

The three deferred defects are fixed: the preflight Fix no longer proposes a language the UI cannot
represent, `/status` now actually applies the rate limit it declares, and duplicating a profile or
moving one between machines no longer drops most of its configuration (both builders now share one
field mapper).

## The incident this release has to carry

The updater signing key was rotated in 0.6.44 because `docs/RELEASE.md` said the password was
missing and `latest.json` was not being published. **That document was stale.** CI had been signing
successfully all along — v0.6.42's published installer verifies against the key it shipped. Acting
on the stale doc replaced a working key and overwrote its password, so the old key cannot sign again.

Consequence: **builds up to 0.6.42 embed the old public key and cannot auto-update to 0.6.45** —
Tauri checks the artifact signature inside `download()`, against the key compiled into the running
build, so such a build offers the update and then fails it. One manual reinstall of 0.6.45 is
required; from 0.6.45 on, updates work normally.

This is recorded rather than smoothed over because the failure mode is invisible: a silent key
rotation breaks no build, fails no test, and shows the user a correct-looking version. It was found
by verifying a real published artifact against the key a real installed build carries, and that is
now what `tests/unit/updaterKeyIdentity.test.ts` automates.

## Acceptance

Guards red-checked individually; clone and bundle round trips proven by running them; `typecheck`,
`build` and the full suite run — **163 files, 1362 passed, 12 skipped, 0 failed**.
