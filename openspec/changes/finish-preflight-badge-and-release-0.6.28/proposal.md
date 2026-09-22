# Finish the preflight badge, sweep for defects, release 0.6.28

## Why

Requested: «Надо доделать фичу, поискть баги и запушить все в новый релиз».

The unfinished feature is the preflight badge. `PreflightBadge` is complete and fully styled, but
nothing renders it. Tracing the history showed this was not an accident of construction: commit
`3a3d790` intentionally dropped the Preflight **column** at operator request — *"the profiles table
no longer carries Device/OS, Fingerprint or Preflight"* — and left the import plus eight orphaned
`useState` declarations behind. The preflight feature itself works; only the at-a-glance status in
the row was missing.

Restoring the column would reverse a recorded decision, so the placement was put to the operator.
The answer: embed the badge in the Actions cell, replacing the shield button, and delete the dead
state. Both are recorded in `manifest.md` as R04 and R05.

## What Changes

- **The badge is rendered in the Actions cell.** It reuses the component and CSS unchanged, and the
  same `inspectPreflight` / `runPreflight` handlers the shield button used, so clicking behaves
  exactly as before — the difference is that the row now shows PASS / WARN / FAIL / CHECKING and a
  count of failing or warning checks without a click.
- **The dead state is deleted.** Seven orphaned `useState` declarations, the `copySeedToClipboard`
  helper whose only user was one of them, and the unused `DevicesIcon` import — all proven dead by
  grep (assigned, never read) and each removed together with its call sites.
- **The preflight subsystem is swept for defects.** It is the previously-unexplored area, and it is
  what this change touches. Every finding is reproduced before being acted on and every fix proven
  by execution.
- **Release 0.6.28** carries the result.

## Capabilities

### New Capabilities
None — this completes an existing display and removes dead code.

### Modified Capabilities
- `profile-preflight-check` — the verdict becomes visible in the profile row again, without
  re-adding the column that was removed.

## Impact

- `src/renderer/src/pages/Profiles.tsx` only for the feature work; preflight files only if the sweep
  produces a reproduced defect.
- No API contract change, no database change, no migration.
- Version bump in four files, SBOM regeneration, CHANGELOG entry, tag `v0.6.28`.
