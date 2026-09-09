## Why

ShardX lets users move the data root (profiles, user data, extensions, trash) to any disk with copy-verify-progress semantics. We have a configurable data directory but no relocation flow: moving today means manual copying while the app is stopped, with no integrity verification and orphaned paths in DB records.

## What Changes

- New service `src/main/dataRoot/mover.ts`: `moveDataRoot(targetDir, onProgress)`:
  1. Gate: refuse while any profile is running; acquire an exclusive move-lock.
  2. Copy every top-level data subtree (profiles, extensions, backups, logs, chromedriver, chromium cache markers; NOT `service.lock`, NOT `antidetect.db` live handles) to the target with per-file progress.
  3. Verify: byte-compare file count + total size + per-file size equality; mismatch → abort with target marked incomplete (nothing deleted).
  4. Swap: close DB handles, copy the DB atomically last, persist the new data-root setting, restart services against the new root, remove the old root only after a successful reopen-and-read check.
- API: `POST /api/v1/settings/data-root/move` (target, progress via SSE or polling `GET .../move/status`), `POST .../move/cancel`.
- Settings page: "Data Folder" section gains a Move flow with progress and cancel.

## Capabilities

### New Capabilities
- `movable-data-root`: gated relocation, copy-verify-swap, progress/cancel API, settings UI flow.

## Impact

- `src/main/dataRoot/mover.ts` (new), `src/main/config.ts` (data-root setting), `src/main/api/routes/` (route; integration owner), `src/renderer/src/pages/Settings.tsx`, tests in `tests/unit/dataRootMove.test.ts` (fs sandbox).
- DB `profile` rows store absolute paths today? — migration note: mover rewrites stored absolute paths under the old root to the new root (one UPDATE pass); relative paths untouched.