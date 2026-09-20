# Interfaces — fix-five-reported-defects

Orchestrator-owned. Frozen before the build. One owner per file; zones disjoint.

## Contract: transfer response shape

`POST /api/v1/data/transfer` keeps `code`/`msg`/`data` and `data.from`, `data.ok`,
`data.dependencies`, `data.workspace_failures`. It ADDS:

```ts
data: {
  created: number;      // profiles inserted (id was absent)
  updated: number;      // profiles whose row was replaced from the source   <- new
  skipped: number;      // profiles already identical to the source
  dependents: number;   // rows carried in profile-keyed tables               <- new
  workspaces: number;
  workspaces_verified: number;  // copied workspaces with a readable cookie/login file <- new
}
```

`updated` counts only rows where the source's values actually differed; a row that is already
identical increments `skipped`. The Settings UI prints all of them.

## Contract: durable stealth key

New module `src/main/security/stealthKey.ts`. Owner: slice C.

```ts
/** The installation's stealth signing key. Created once, then reused across restarts. */
export function getStealthSigningKey(dataDir: string): KeyPairPem;
/** True when a persisted key already existed. */
export function hasPersistedStealthKey(dataDir: string): boolean;
```

- Storage: `secretStore.protectSecret` (DPAPI on Windows) into `<dataDir>/stealth-key.json`.
- `getEphemeralStealthKeyPair()` keeps its name and its role for tests, but
  `verifyStealthExtensionDirectory` resolves its default keyring from `stealthKey` when a data
  directory is known, so a persisted key verifies across processes.
- On `key-not-found`/`digest-mismatch`: regenerate the extension from `writeStealthExtension`
  with the persisted key, re-verify, proceed. Log at `info` with the profile id and the reason.
  Abort only if regeneration also fails.

## Contract: stop-all before exit

`shutdown()` in `src/main/index.ts` already awaits `stopAll()`. The change is:

- `stopAll()` returns `Promise<{ stopped: string[]; failed: string[] }>` instead of `void`.
- `shutdown(reason, code)` logs `failed` ids at `error` and still exits.
- Every caller keeps working: `void shutdown(...)` ignores the return.

## Contract: table layout

CSS-only + a small class addition. Owner: slice A.

- New token `--table-actions-w: 132px`.
- `.table-container { overflow-x: auto }` (was `hidden`).
- `.table--wide` for the profiles table: `min-width: 1080px` so columns stop compressing.
- `.table th.col-actions, .table td.col-actions { position: sticky; right: 0 }` with the app's
  background so the pinned column does not show rows scrolling under it.

## File ownership

| Slice | Owner | Files |
|---|---|---|
| A | fixer-frontend | `src/renderer/src/styles.css`, `src/renderer/src/pages/Profiles.tsx`, `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/api.ts` (types only) |
| B | fixer-transfer | `src/main/api/routes/proxy.ts`, `tests/unit/dataTransfer.test.ts` |
| C | fixer-security | `src/main/security/stealthKey.ts` (new), `src/main/security/extensionVerifier.ts`, `src/main/launcher/chromium.ts`, `tests/unit/stealthKey.test.ts` (new) |
| D | fixer-lifecycle | `src/main/index.ts`, `src/main/launcher/chromium.ts` (stopAll only — coordinate with C), `src-tauri/src/main.rs`, `src-tauri/src/tray.rs` |

**Conflict rule:** C and D both touch `src/main/launcher/chromium.ts`. C owns `startProfile` and
the stealth block; D owns `stopAll`/`stopProfile`. Each edits only its own function and messages
the other through `hub` before touching a shared region.

## Non-goals

- No change to the transfer's dependency-table semantics (groups, proxies, devices stay
  add-only; only `profiles` becomes source-wins).
- No new runtime dependency.
- Firefox is out of scope.
