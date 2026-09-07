## Why

Automated scrapers, QA test runners, and multi-accounting workflows frequently require disposable, short-lived browser profiles. Storing them in SQLite and creating permanent directories causes disk clutter, database bloat, and potential data leakage. Disposable profiles guarantee zero-persistence with strictly sandboxed lifecycles.

## What Changes

- Ephemeral profile creation via `POST /profiles/temporary` without permanent database rows.
- Isolated filesystem allocation under dedicated `.temporary_profiles/<uuid>` paths.
- Multi-signal automatic cleanup: deletion on browser window close, stop API call, or launcher shutdown.
- Startup orphan purges to eliminate stale directories following crashes or unexpected power failures.
- Strict isolation: temporary profiles are excluded from default `GET /profiles` listings and cannot modify persistent data.

## Capabilities

### New Capabilities
- `disposable-profiles`: Ephemeral profile lifecycle, isolated directory allocation, multi-signal cleanup, and startup orphan sweeps.

### Modified Capabilities
None.

## Impact

- `src/main/profiles/`: In-memory temporary profile registry and lifecycle management.
- `src/main/launcher/`: Temporary directory creation, cleanup listeners, and startup orphan purges.
