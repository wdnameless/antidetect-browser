# fix-five-reported-defects

Five defects the operator reported in one message, from one screenshot set and one live error.

## Why

| Reported | Cause found |
|---|---|
| The Actions column depends on window size | `.table-container` is `overflow: hidden` and the column widths sum to 100% **plus** a fixed 40px checkbox column, so the last column is clipped with no way to reach it |
| Profile names did not transfer | `INSERT OR IGNORE` never updates an existing row. Reproduced: a destination holding a stale name for the same id keeps it, and the transfer reports the row as `skipped` — success with nothing applied (R02) |
| Sessions and everything else must transfer | The transfer copies rows and profile folders, but `profile_extensions` bindings and per-profile rows in dependent tables are keyed by profile id and were never carried, so a transferred profile launches naked (R03) |
| The collapse arrow must go | Already removed in 0.6.9 (commit `6c55775`); verified absent from source and from the built bundle. Re-asserted as R04 so it cannot return |
| `key-not-found`, launch aborted | The stealth signing key is **ephemeral to the process** (`getEphemeralStealthKeyPair`), while the signed manifest lives on disk in the profile. Second app run: the artifact's `keyId` is not in the new process's keyring. Reproduced across two processes (R05) |
| Tray quit leaves profiles open | `shutdown()` does call `stopAll()`, but Chromium is spawned with `stdio: 'ignore'` and no breakaway, so the profiles are inside the shell's kill-on-close job object only in the backend's tree — and the backend's stop path depends on `running` being populated, which a shell restart does not guarantee. The tray Quit path likewise calls `app.exit(0)`, whose teardown races the 5s graceful window (R07) |

## What changes

- **Table**: the container scrolls horizontally; the Actions column is pinned to the right edge so it is reachable at any width (R01).
- **Transfer**: `profiles` rows become source-wins on id collision; dependent rows keyed by profile id (`profile_extensions`, `profile_tags`) are carried; the workspace copy is verified by content, not by call (R02, R03).
- **Stealth key**: the signing key is persisted through the existing `secretStore` (DPAPI-backed) under the data folder, so a signed artifact verifies across restarts. A mismatch re-signs the artifact from our own generator; only a failure to re-generate aborts the launch. Verification stays fail-closed for a genuinely tampered artifact (R05, R06).
- **Tray quit**: the quit sequence stops profiles, waits for them, then exits, and reports any profile it could not stop (R07, R08).

## Impact

- Data: `profiles` rows may be updated on transfer — this is the operator's explicit choice
  ("Победа источника"). Existing workspaces are still never overwritten by the file copy.
- Security: the stealth key becomes durable, but the enforcement path is unchanged and R06 proves
  a tampered artifact is still refused.
- API: no route changes; `POST /api/v1/data/transfer` keeps its shape and gains
  `updated` + `dependents` counters in `data`.
