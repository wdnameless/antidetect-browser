# Manifest — finish the preflight badge, sweep, release 0.6.28

Requirement rows are the contract. Each `R##` quotes the user verbatim where it came from them, and
cites measured evidence where it came from the codebase.

## User requirements (verbatim)

> «Надо доделать фичу, поискть баги и запушить все в новый релиз»

- **R01** — «надо доделать фичу» → *the identified feature is completed and visibly working.*
- **R02** — «поискть баги» → *defects are actively hunted, not assumed absent.*
- **R03** — «запушить все в новый релиз» → *everything is committed, pushed, and published as a new release.*

## Wave 0 decisions (user-selected)

- **R04** — Badge placement: **embed in the Actions cell**, replacing the shield button. It shows
  PASS / WARN / FAIL / CHECKING and an issue count without a click, and adds no column — this keeps
  the operator's earlier decision in `3a3d790` to keep the table narrow.
- **R05** — Dead state: **delete all of it** — the eight orphaned declarations, `copySeedToClipboard`,
  and the unused `DevicesIcon` import.

## Measured facts this change is built on

- **R06** — `PreflightBadge` exists complete and styled but has no render site. It was removed
  deliberately in `3a3d790`, which also left the import and eight now-dead declarations behind.
- **R07** — The preflight feature still works end to end through the shield button; only the
  at-a-glance status is missing. So this completes a display, not a backend.

## Acceptance criteria

- **R08** — The Actions cell renders the badge; with no verdict it reads as an idle check control;
  with one it shows the status and the count of failing/warning checks, without a click.
- **R09** — Clicking it preserves the shield button's behaviour: an existing verdict opens the modal,
  no verdict runs a fresh check and opens it.
- **R10** — Each removed identifier has zero remaining occurrences in the file, and the renderer
  typechecks clean.
- **R11** — The preflight subsystem is swept for defects; each finding is reproduced before being
  acted on, and each fix is proven by execution.
- **R12** — `v0.6.28` is published, and its updater signature verifies against the pubkey configured
  in `tauri.conf.json` — the check the installed app performs.

## Explicit non-goals

- **R13** — Do not re-add a Preflight column. That reverses a recorded operator decision.
- **R14** — Do not touch the preflight backend contracts (`run` / `last` / `start-with-preflight`)
  unless the sweep finds a reproduced defect.
- **R15** — No unrelated refactoring. Dead code is removed only where it is provably dead.
