# Interfaces — parity-audit-2026-09-20

This change writes no product code, so there are no module boundaries to freeze. What follows
is the boundary between the audit and the **fix work it may trigger**, so that whoever picks up
a finding starts from the right code path.

## Deliverables

| Artifact | Path | Owner |
|---|---|---|
| Recon notes | `.workflow/recon-parity-audit-2026-09-20.md` | orchestrator |
| Requirements manifest | `openspec/changes/parity-audit-2026-09-20/manifest.md` | orchestrator |
| This contract | `openspec/changes/parity-audit-2026-09-20/interfaces.md` | orchestrator |

## Fix-entry points per finding

Each finding names the exact code a fix must touch. No finding crosses into another's files,
so a fix queue can be parallelised as written.

| Finding | Sev | Entry point | The invariant a fix must restore |
|---|---|---|---|
| B1 | CRITICAL | `src/main/util/backupManager.ts:37` + `src/main/db/index.ts:50,197` | After a restore, the live database must BE the restored database. Either reload the instance inside `restoreBackup`, or refuse further writes until a reload happens. A `restart_required` flag in the HTTP response is advice, not enforcement. |
| B2 | HIGH | `src/main/config.ts:55-78` | A settings file that fails to parse must be preserved (renamed aside) before defaults are written, so an operator can recover their data directory, ports and paths. |
| B3 | MEDIUM | `mcp/src/server.ts:196-210` | An HTTP request without a verifyable Bearer token must not receive a tool catalogue. `tools/list` currently answers with 47 tools unauthenticated. Note the boundary: tool EXECUTION already fails unauthenticated, so a fix must not break the working path. |
| B4 | MEDIUM | `src/main/profiles/profileManager.ts:829-839` | A purge must not delete data for a profile that was restored between the `SELECT` and the delete. Re-check `deleted_at` inside the loop, or purge in one statement. |
| B5 | LOW | `src/main/launcher/chromium.ts:454,610` | A failed spawn must not leave the user-data directory for a TEMPORARY profile. Non-temporary directories are reused by design and must be left alone. |

## What a fix must NOT do

- **B1 must not** be solved by forcing an immediate process exit. The operator restoring a
  backup may be recovering from a crash; killing the app mid-recovery is worse than the bug.
  A primitive for the correct fix already exists: `db/index.ts` exports `closeDb()` (line 275)
  and `initDb()` (line 197), so the restore path can drop the in-memory instance and reopen
  from the restored file. The defect is that nothing calls them after `restoreBackup`.
- **B3 must not** gate the whole `POST /mcp` route behind auth. Tool *execution* already
  fails without credentials (verified: `profiles.create` → `unauthorized`); the defect is
  that the *catalogue* leaks. Tighten listing, keep the working path working.
- **B5 must not** delete user-data directories for ordinary profiles. `deleteProfile` is a
  soft delete by design (`profileManager.ts:760-770`); only the temporary-launch failure path
  is in scope.

## Evidence standard for a fix

A fix is accepted when the same test that demonstrated the defect now passes and its
counterpart still does: for B1, a restore followed by an ordinary write must leave the
restored value in the file, and the reproduction recorded here (`STATE_A` → write → `STATE_A`)
must be the assertion. A green suite that never exercised the restore path is not evidence.
