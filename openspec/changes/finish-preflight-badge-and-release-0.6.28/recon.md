# Recon — finish the preflight badge, sweep, release 0.6.28

## Task

> «Надо доделать фичу, поискть баги и запушить все в новый релиз»

## What "фича" actually is (traced, not assumed)

`PreflightBadge` is fully implemented and fully CSS-styled — `components/PreflightModal.tsx:15-70`
and `styles.css:1849-1900` — but **nothing renders it**: `Profiles.tsx` imports it and never uses it.

The history explains why, and it changes what "finish" may mean:

- commit `c0ffddf` (Afina-parity Wave 2) added the badge in its own `<td>` — a Preflight column.
- commit `3a3d790` removed that `<td>` **deliberately**, at operator request. Its changelog reads:
  *"The profiles table no longer carries Device/OS, Fingerprint or Preflight. Columns are now
  Profile Name, Proxy, Status, Actions."* It left the import behind, along with several now-orphaned
  `useState` declarations.

So the feature was not half-built by accident; its display was removed on purpose and the leftovers
were never cleaned. Restoring the column would reverse a recorded operator decision, so the Wave 0
question was put to the operator rather than decided here.

## Wave 0 answers (recorded)

| Fork | Answer |
| --- | --- |
| Badge placement | **Embed in the Actions cell** — replaces the shield button, shows PASS/WARN/FAIL/CHECKING plus an issue count, no new column. |
| Dead state | **Delete all of it** — the eight orphaned declarations plus `copySeedToClipboard`. |

## Inventory

| Item | State | Evidence |
| --- | --- | --- |
| `PreflightBadge` component | EXISTS, complete, styled | `PreflightModal.tsx:15-70`; CSS `styles.css:1849-1900` |
| Badge render site | ABSENT (deliberately removed) | `3a3d790` diff; `grep '<PreflightBadge'` in `Profiles.tsx` → 0 |
| Preflight shield button in Actions | EXISTS | `Profiles.tsx:1717-1723`, opens the modal |
| Preflight backend + routes | EXIST | `src/main/preflight/*`, `routes/preflight.ts` |
| Modal, cache, handlers | EXIST | `preflightCache` (255), `inspectPreflight` (~330), `runPreflight` (~275) |
| Dead declarations | 8 + 1 helper | assignment-only values; every setter is called but no getter is ever read |
| Dead import | `DevicesIcon` | used in `App.tsx`, not in `Profiles.tsx` |

## Acceptance check (observable)

1. The Actions cell renders a preflight control that shows status without a click: idle "Check",
   then PASS / WARN / FAIL / CHECKING, with an issue count when checks are not all clean.
2. Clicking it opens the preflight modal (or runs a check when none exists) — same behaviour the
   shield button had.
3. `grep` proves each removed identifier has zero occurrences left; renderer typecheck clean;
   `noirTokens` (CSS token discipline) still passes.
4. A bug sweep of the previously-unexplored preflight subsystem, with every finding reproduced
   before it is acted on.
5. A published `v0.6.28` whose updater signature verifies against the configured pubkey.
