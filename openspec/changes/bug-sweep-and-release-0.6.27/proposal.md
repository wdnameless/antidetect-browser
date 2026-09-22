# Bug sweep + release 0.6.27

## Why

Requested: «Ищи ошибки и выкатывай релиз ччтобы я обновился» — hunt defects, then ship a release the
user can update to.

The cookie-farm module had just been delivered and accepted, but acceptance proves the happy path;
it does not prove the failure paths. An adversarial review was run against the diff, and it found
nine defects — two of them P0. Every finding was reproduced against the code before being acted on,
and every fix was proven by a probe against a real running service.

## What changed

Fixes, each with the failure it closes (details and evidence in `manifest.md`):

- **Tab hijacking (P0)** — the crawl used `pages[0]`. On a profile the operator already had open
  that is their own visible tab: the warm-up navigated it across twenty sites and closed it.
- **Leaked headless profile (P0)** — a failure between `startProfile` and the returned `close()`
  left a started profile running with no path to stop it.
- **Abort ignored (P1)** — the new 5s consent wait did not poll the kill switch.
- **False ownership (P1)** — `managedProfile` was `true` even for a profile the run never started.
- **Zero-page "success" (P2)** — `urls: []` bypassed the built-in list, and `maxPages: "abc"`/`null`
  became `NaN`/`0`; a browser launched, nothing was visited, and the report said `completed`.
- **Stale abort key (P2)** — `activeRuns` was registered under two keys and deleted by one.
- **UI dead end (P2)** — closing the modal mid-run froze the table with no indicator.
- **Unusable machine SID (latent)** — `whoami /user` called bare resolves through `PATH`; on a host
  with Git ahead of `System32` that is Git's `whoami`, so the SID fell back to a placeholder that is
  mixed into every Secure Preferences MAC.
- **Release risk** — `mcpBundle.test.ts` could exceed the 20s default under load and fail the CI
  `test` job, which the `release` job is gated on (`needs: [test]`).

Release: version raised to `0.6.27` in `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`; SBOM regenerated; CHANGELOG entry written; tag
`v0.6.27` pushed.

## Capabilities

### New Capabilities
- `cookie-farm-warming` (delivered previously) — this change hardens it.

### Modified Capabilities
None.

## Impact

- `src/main/scripts/modules/cookieRobot.ts`, `src/main/scripts/modules/cookieFarm/consent.ts`,
  `src/main/extensions/securePreferences.ts`, `src/renderer/src/pages/Profiles.tsx`,
  `tests/unit/mcpBundle.test.ts`, version files, SBOM, CHANGELOG.
- No API contract change: the fixes are behavioural. `createProfilePageSupplier` now also returns
  `ownsProfile`, which only the runner consumes.
