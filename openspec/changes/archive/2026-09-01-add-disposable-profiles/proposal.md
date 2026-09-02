## Why

Automation workloads, transient test scripts, and rapid credential checks require ephemeral browser sessions that leave zero lingering filesystem or database residue upon completion. Currently, all profiles created in `src/main/profiles/profileManager.ts` and `src/main/api/routes/profiles.ts` persist in the SQLite database and on disk. A dedicated temporary profile lifecycle prevents storage bloat, ensures strict isolation of user data directories, guarantees thorough cleanup on normal exit, kill, crash, or host restart, and strictly protects persistent user data and preserved exports from accidental purge.

## What Changes

- Add temporary profile lifecycle management in `src/main/profiles/profileManager.ts` and API endpoint `POST /profiles/temporary` in `src/main/api/routes/profiles.ts`.
- Allocate isolated, random UUID-tagged `user-data-dir` paths under a dedicated `.temporary_profiles/` directory hierarchy, completely isolated from persistent profile stores.
- Register disposable instances into an in-memory lifecycle registry backed by an on-disk ephemeral lock/manifest.
- Implement cleanup hooks in `src/main/launcher/chromium.ts` that execute on normal exit, SIGTERM/SIGINT kill, process crash, or launcher abort.
- Implement a startup purge sweep in the launcher service that discovers and securely removes orphaned temporary profile directories older than the startup epoch, with explicit path guards preventing any intersection with persistent profile folders or `preserved_browser_data` archives.
- Ensure temporary profiles are never synced to remote servers and never included in standard profile enumeration unless explicitly requested with transient filters.

## Capabilities

### New Capabilities
- `disposable-profiles`: Ephemeral profile lifecycle, isolated directory allocation, multi-signal cleanup guarantees, startup orphan purge sweep, and persistent data isolation.

### Modified Capabilities
- None

## Impact

- Affected systems: `src/main/profiles/profileManager.ts`, `src/main/api/routes/profiles.ts`, `src/main/launcher/chromium.ts`, and profile filesystem storage.
- Dependencies: Governed under umbrella `openspec/changes/stealth-parity-hardening` (Task 5.3). Depends on baseline and network transport safety. Must maintain strict separation from Camoufox-removal `preserved_browser_data` structures.

## Goals / Non-Goals

**Goals:**
- Provide fast `POST /profiles/temporary` creation and instant launch capability.
- Guarantee 100% filesystem cleanup of temporary `user-data-dir` on normal exit, crash, or restart.
- Maintain a startup purge sweep for orphaned directories.
- Strictly isolate temporary profile cleanup so it can never touch or delete persistent profiles or preserved data.

**Non-Goals:**
- Modifying persistent profile schema or storage layout.
- Implementing cross-session temporary state persistence.
- Modifying remote sync server protocols (temporary profiles are strictly local).

## Risks / Trade-offs

- [Disk accumulation if launcher crashes hard] -> Addressed by startup purge sweep and locked pidfile validation.
- [Accidental deletion of persistent data] -> Addressed by dedicated lifecycle registry, strict directory containment assertions (`isSubdirectory(tempBase, targetPath)`), and explicit refusal to touch `preserved_browser_data`.

## Migration and rollback

- Additive feature. No changes to persistent profile schemas.
- Rollback: Disabling temporary routes and cleaning `.temporary_profiles/` directory safely returns launcher to persistent-only operation.
