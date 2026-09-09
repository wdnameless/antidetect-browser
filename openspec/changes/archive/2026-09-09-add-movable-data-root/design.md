# Design: Movable Data Root

## Key Decisions

1. **Copy-verify-swap, never move-in-place**: the old root is only deleted after the new root passes a reopen-and-read check (DB opens, profile list non-empty or explicitly empty). Failure at any stage leaves the old root untouched and complete.
2. **Running-profile gate + move-lock**: refuse to start while any profile runs; `data/move.lock` (like `service.lock`) prevents concurrent movers.
3. **DB last**: the SQLite file is closed, copied, and atomically verified last so a crash mid-copy never leaves a half-persisted DB in the new root.
4. **Absolute-path rewrite**: one UPDATE pass rewrites stored absolute paths with the old-root prefix → new-root prefix (idempotent, string-prefix replace, verified row count reported).
5. **Progress + cancel**: progress = files copied / total files (dir walk pre-count); cancel checkpoint between files; status endpoint reports phase (`copy|verify|swap|done|error`).
6. **Exclusions**: `service.lock`, `move.lock`, live WAL/SHM (checkpointed via `flushDb()` before copy), and `.temporary_profiles` (purged via existing sweep first).

## Testing Strategy

- `tests/unit/dataRootMove.test.ts` in an fs sandbox (two temp roots):
  - refuse when a profile is running; refuse concurrent moves;
  - copy-verify-swap happy path: after completion, new root opens, DB row count preserved, old root removed, data-root setting points at new root;
  - injected verify failure (tamper a file between copy and verify): abort, old root intact and still authoritative, target marked incomplete;
  - absolute-path rewrite: profile row with old-root path rewritten; relative path untouched;
  - cancel mid-copy: partial target cleaned, no setting change.