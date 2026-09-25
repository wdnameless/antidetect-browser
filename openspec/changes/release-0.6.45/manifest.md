# Manifest — release 0.6.45

## Requested

| # | Requirement (verbatim) | Status | Evidence |
|---|---|---|---|
| R1 | «Пофикси все сам» — close the three issues 0.6.44 left open | Met | All three fixed and each guard red-checked; see R2–R4. |
| R2 | «чтобы я мог обновиться через приложение» — in-app update must work for the operator | **Blocked by a mistake of mine — see R5.** The chain itself is proven working (`latest.json` published, signature valid against the shipped key). The operator's installed build cannot use it without one manual reinstall. | |

## The three deferred defects

| # | Defect | Proof it was real |
|---|---|---|
| R2 | The preflight Fix wrote bare language subtags (`de`) that the language select cannot represent | The select matches options by exact value. A bare subtag matched nothing, rendered "Auto", and the next Save wrote the empty string over it. Table now holds full locales only. |
| R2a | **My first fix for R2 introduced the identical bug**: six proposed locales (`uk-UA`, `be-BY`, `kk-KZ`, `pt-PT`, `en-IN`, `en-SG`) are not locales the catalog derives, so the select could not show them either | Caught by measuring the table against the served list before shipping. Guarded: a test checks the whole table against `GET /api/v1/browser-profile/languages`. |
| R3 | `/status` declared a 50 req/s limit it never applied | The route is registered before the global `rateLimitMiddleware` (it is an unauthenticated health check and must answer before the auth gate), so the declared limit was dead configuration. Middleware is now attached at the route — moving the route behind the global middleware was rejected, as that would put a health check behind authentication. |
| R4 | Duplicating a profile — and moving one between machines — dropped most of its configuration | Measured round trip: a clone lost `start_urls`, `launch_args`, `color`, `blocked_ports`, `webrtc_policy`, `headless`; the bundle lost the same seven. Both builders had their own copy of the mapping, which is how they dropped the same fields independently; they now share one mapper. |

## R5 — my own mistake, recorded

The updater signing key was rotated in 0.6.44 because `docs/RELEASE.md` stated the password was
wrong and `latest.json` was not being published. **Both claims were stale.** CI had been signing
successfully; v0.6.42's published installer verifies against the key it shipped. I trusted the
document instead of checking whether releases were actually signed, replaced a working key, and
overwrote the password secret in the process, so the old key cannot sign again.

Consequence, stated plainly: **builds up to 0.6.42 embed the previous public key and cannot
auto-update from 0.6.45.** Tauri verifies the artifact signature only in `download()`, against the
key compiled into the running build, so such a build reports "Update available" and then fails with
"Update verification failed". One manual reinstall is required.

What was done about it:
- `resources/release-key-identity.json` records the shipping key id and keeps the retired key on
  record, so published signatures stay attributable.
- A test fails if the pubkey changes without updating that record — verified by swapping the key
  back and watching it fail. A silent rotation breaks no build and fails no test, which is exactly
  why it went unnoticed; it is now impossible to do silently.
- `docs/RELEASE.md` no longer presents the password failure as current, and states that changing the
  signing key is a breaking event.

## Acceptance

- Guards **red-checked individually**: preflight map reverted → 2 guards fail; clone field coverage
  reverted → clone guard fails; pubkey swapped to the retired key → identity guard fails. Each then
  restored and passing.
- Round trip proven: clone keeps the configuration (note intentionally excluded), bundle export →
  re-import is byte-identical in behaviour, and a bundle missing the new fields still imports.
- `npm run typecheck`, `npm run build`, `npm test` — the three commands CI runs.
- Full suite: **163 files, 1362 passed, 12 skipped, 0 failed.**
