## Context

High-throughput browser automation and testing scripts frequently require short-lived profiles that are created, launched, driven, and torn down in rapid succession. Persisting every ephemeral session into primary database tables and filesystem directories creates disk fragmentation, slows down database queries, and introduces privacy risks if transient authentication tokens remain cached on disk.

Dated public ShardBrowser/ShardX observations (2026-08) note transient browser instances for isolated test runs. This design establishes an isolated disposable profile capability with verifiable cleanup semantics.

## Decisions

### 1. Dedicated lifecycle registry and endpoint
Implement `POST /profiles/temporary` in `src/main/api/routes/profiles.ts`.
- Accepts standard profile configuration parameters (fingerprint seed, proxy, custom args, startup URL).
- Returns profile metadata containing `temporary: true` and a dedicated UUID.
- Does NOT insert permanent rows into the primary `profiles` SQLite table; instead, registers into an in-memory `DisposableProfileRegistry` backed by an ephemeral state manifest.
- *Alternative rejected*: Marking normal DB profile rows with `is_temporary=1`. Rejected because crashing before DB cleanup leaves dangling rows that pollute standard profile listings.

### 2. Isolated filesystem location and directory guards
All temporary profile user data directories are allocated strictly under:
`<userDataRoot>/.temporary_profiles/<profile-uuid>/`
- The cleanup engine MUST verify that any path targeted for deletion satisfies `path.resolve(target).startsWith(path.resolve(userDataRoot, ".temporary_profiles"))`.
- Under NO circumstance may the disposable cleanup logic touch persistent profile paths (`<userDataRoot>/profiles/*`) or preserved archive directories (`<userDataRoot>/preserved_browser_data/*`).

### 3. Multi-signal lifecycle cleanup
Cleanup routines in `src/main/launcher/chromium.ts` and `src/main/profiles/profileManager.ts` guarantee removal:
1. **Normal Exit**: Browser process exit code captured -> synchronous file unlock -> asynchronous recursive deletion.
2. **Explicit Stop API**: `POST /profiles/{id}/stop` or `DELETE /profiles/{id}` triggers graceful SIGTERM -> wait up to 3s -> SIGKILL -> deletion.
3. **Launcher Process Signals**: Node.js `beforeExit`, `SIGINT`, `SIGTERM`, and `SIGHUP` handlers iterate all registered active temporary profiles and trigger immediate synchronous unlink/kill.
4. **Crash/Kill**: Process termination unlinks lockfiles.

### 4. Startup orphan purge sweep
When the launcher starts:
1. Scans `<userDataRoot>/.temporary_profiles/`.
2. Inspects directory lockfiles and process PID liveness.
3. Recursively purges any directory whose owning process is dead or created prior to the current startup epoch.
4. Emits a structured log of purged temporary workspaces.

### 5. Exclusion from remote sync and persistent exports
Temporary profiles are strictly excluded from:
- Cloud/server sync payloads.
- Local backup archives.
- Default `GET /profiles` listing (unless query parameter `include_temporary=true` is explicitly provided with administrative credentials).

## Risks / Trade-offs

- [File lock contention on Windows during deletion] -> Retry loop with exponential backoff (100ms, 200ms, 400ms up to 3s) handles pending Windows file handles before final unlink.
- [Memory footprint of ephemeral registry] -> Bounded active session table cleaned on process exit.

## Migration Plan

- Completely non-breaking and additive.
- Rollback: Stop accepting temporary requests; any existing `.temporary_profiles/` folder can be removed safely without impacting persistent user profiles.
