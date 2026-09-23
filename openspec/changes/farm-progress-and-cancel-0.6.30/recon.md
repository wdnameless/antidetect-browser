# Recon — farm progress, closable modal, cancel (release 0.6.30)

## Bug report (verbatim, with screenshot)

> «Не нажимается close и очень долго уже крутиться и нет прогресса, не понятно фаримт он куки или нет»

The screenshot shows the cookie-farm modal: a bare spinner, "Warming up profile (visiting sites,
collecting cookies, accepting consent)...", and a Close button that does nothing. Profile
`door_inseam_2i_13`.

## Root causes — both measured in the source

**1. Close is disabled during the run, and this is a regression I introduced in 0.6.27.**
`Profiles.tsx` renders the modal's Close with `disabled={cookieFarmModal.loading}` and its `onClose`
returns early while loading:

```tsx
onClose={() => {
  if (!cookieFarmModal.loading) setCookieFarmModal((prev) => ({ ...prev, isOpen: false }));
}}
```

That was a deliberate change at the time, and the reasoning was wrong for a run of this length: with
no other progress indicator I made the modal the only feedback available and then removed the exit
from it. The operator is left trapped in a modal, which is worse than the frozen-table problem the
change was meant to solve.

**2. The run is one blocking HTTP request with no intermediate reporting.**
`POST /api/cookie-robot/run` awaits the entire crawl before answering. The defaults are `maxPages`
20 and `sessionCapMs` 300000 (five minutes), so the spinner can sit for minutes with no way to tell
progress from a hang. There is also no cancel control in the modal — `POST /api/cookie-robot/stop`
exists on the server but the UI never calls it.

## Inventory (what already exists, so nothing is rebuilt)

| Piece | State | Evidence |
| --- | --- | --- |
| Async start | EXISTS | `POST /api/cookie-robot/run` with `async=true` or `/start` returns `{ runId, taskUuid, profileId }` immediately |
| Abort | EXISTS | `POST /api/cookie-robot/stop` with `{ runId }` → `abortCookieRobotRun` |
| Per-run state | EXISTS | `activeRuns` map, registered under BOTH `runId` and `profileId` |
| Live progress | **ABSENT** | nothing exposes `pagesVisited` while the run is in flight |
| Progress endpoint | **ABSENT** | `grep 'cookie-robot/progress'` → 0 hits |
| Modal close during run | **DISABLED** | the regression above |
| Modal cancel control | **ABSENT** | no `stop` call anywhere in `Profiles.tsx` |

## Acceptance

- Close always dismisses the modal; dismissing does not abort the crawl, and the cookie button
  reopens it with live progress.
- While running the modal shows pages visited out of max, cookies so far, domains touched, consent
  banners accepted, and the site currently being visited — so "is it working?" is answerable at a
  glance.
- A Stop control aborts the run and reports it as aborted.
- Pressing the button during a run reopens the modal instead of starting a second crawl.
- The final report view is unchanged for a completed run.
- Verified by driving the real UI: start a run, observe numbers changing, Close, reopen, Stop.

## Outcome

Reported bugs fixed and verified in a real browser, plus two defects found while verifying:

**Verified working** (`.stealth-bench/verify-farm-final-report.mjs`, driving the real UI):
the live view appears while the crawl runs, a Stop control is offered, and a completed run ends on
real metrics — `20 pages, 23 cookies, 18 domains, 303s` — with **no** error banner. Before the fix
the same probe ended on a red "Cookie farm completed" banner with an empty body.

**Two additional defects found during verification, both fixed:**

1. The polling effect listed the run id as a dependency while the first poll is what learns it, so
   every learn tore the effect down and dropped its in-flight result — the live view was almost
   never entered. The effect now reads the id from a ref, and a tick that finds nothing running
   before the start request has answered is no longer mistaken for a finished run.
2. The runner set `active: false` before writing the report row, and the UI fetches the report the
   moment it sees the run stop — a race the poll lost on every short run. The row is now written
   first.

**Also fixed** (found by lint while preparing this release, pre-existing since `c0ffddf`): the
documented `*.foo.*` blocklist form was unreachable, because `*.foo.*` also starts with `*.` and the
bare branch matched first. An operator writing `*.ads.*` silently got `*.ads` — it blocked
`ads.example.com` but let `example.ads.net` through.

**A wrong turn worth recording:** `tests/unit/apiBindFailure.test.ts` failed intermittently and I
first reported it as a release-blocking flake. It was not: my own long-running service and headless
Chrome probes were starving the machine (vitest `transform` 92s against 18s idle). With the service
stopped the file passes 2/2 and the full suite is green. The timeout change made on that mistaken
diagnosis was reverted rather than shipped.

Full suite: 156 files / 1292 passed. Release v0.6.30 published with every CI job green, and the
installer signature verifies against the configured pubkey.
