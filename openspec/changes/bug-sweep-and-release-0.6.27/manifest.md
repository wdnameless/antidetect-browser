# Manifest — bug sweep + release 0.6.27

## User request (verbatim)

> «Ищи ошибки и выкатывай релиз ччтобы я обновился»

Two asks: (1) hunt defects, (2) ship a release the user can update to.

## Requirements

- **R01** — Errors are actively hunted, not assumed absent. → *adversarial review of the delivered diff, findings verified against the code before being acted on.*
- **R02** — A release is published the user can update to. → *version bumped in all three files, tag pushed, GitHub Release with signed artefacts and `latest.json`.*
- **R03** — «чтобы я обновился» — the update must actually install. → *the published signature must verify against the pubkey the installed app trusts; a release that fails this is invisible to the updater.*

## Findings, each verified before acting

- **F1 (P0, tab hijacking)** — `createProfilePageSupplier` used `(await browser.pages())[0]` as the crawl page. For a profile the operator already had open, that is their own visible tab: the warm-up would navigate it across every farm site and then close it.
- **F2 (P0, leaked process)** — if `puppeteer.connect` or `newPage` failed, the function threw before returning `close()`, so the caller's `finally` had nothing to call and a profile started headless was never stopped.
- **F3 (P1, abort ignored)** — the new 5s consent wait was not abort-aware, so `stop` on a 20-page run could take minutes to take effect.
- **F4 (P1, false ownership)** — `managedProfile` was set to `true` unconditionally on the built-in-supplier path, even when the profile was already running and never started or stopped by the run.
- **F5 (P2, zero-page "success")** — `urls: []` bypassed the built-in site list, and `maxPages: "abc"`/`null` became `NaN`/`0`; both launched a browser, visited nothing and reported `completed`.
- **F6 (P2, stale abort key)** — `activeRuns` was registered under both `runId` and `profileId` but deleted by `runId` only, so a finished run stayed abortable by profile id.
- **F7 (P2, UI dead end)** — closing the modal mid-run left the whole table `busy` for minutes with no indicator and no way back to the report.
- **F8 (latent, extensions)** — `whoami /user /fo csv` called by bare name resolves through `PATH`; where Git for Windows precedes `System32` that is Git's `whoami`, which rejects `/user` and prints `root`. The SID fell back to a hardcoded placeholder that is indistinguishable from success, and that SID is mixed into every Secure Preferences MAC.
- **F9 (release risk)** — `tests/unit/mcpBundle.test.ts` builds a bundle per test; under parallel load one build exceeded the 20s default and failed the CI `test` job, which the `release` job is gated on (`needs: [test]`) — a good tree could publish nothing.

## Acceptance

- **A1** — Both P0s reproduced as failing, then shown fixed by a probe: the operator's tab stays open on its original URL, and `managedProfile` is `false` for a profile the run did not start.
- **A2** — The boundary guards proven live: `urls: []`, `maxPages: "abc"`, `maxPages: null` each visit pages instead of reporting a zero-page success; a completed run is no longer abortable.
- **A3** — The SID fix proven by direct comparison: bare `whoami` fails, the absolute path returns the real SID.
- **A4** — Full suite green (156/156 files), typecheck clean on both main and renderer.
- **A5** — Release published with `latest.json` whose signature verifies against `tauri.conf.json`'s pubkey.

## Non-goals

- No refactor of unrelated code. The ten unused locals/imports in `Profiles.tsx` are pre-existing at HEAD (verified by count) and were left alone.
