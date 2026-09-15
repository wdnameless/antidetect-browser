# Design — Retire Electron, ship the Tauri shell

## Context

A ~300-line Electron wrapper (`electron/main.ts`, `electron/preload.ts`) provides five things to
an otherwise Electron-free system: a frameless window, native folder dialogs, a tray icon, an
auto-updater, and a DPAPI cipher. The backend (`src/main/`) is Node and starts under plain
`node`. The renderer is HTTP/WebSocket-only and touches exactly one native surface — the
`window.antidetect` bridge — behind a `hasNativeWindow` guard.

Facts established by measurement, not assumption:

| Fact | Evidence |
|---|---|
| Backend needs no Electron | `node dist/src/main/index.js` → `[antidetect] Local API listening on http://127.0.0.1:50399` |
| The existing Tauri shell is broken twice over | spawns `dist/electron/main.js` (dies on `electron-updater` under node); waits for `"Server running at"`, which is never printed |
| `frontendDist` as an HTTP URL is legal in v2 | `FrontendDist::Url(Url)` in `tauri-utils/src/config.rs` |
| Tauri v2 remote IPC needs an explicit capability | `capabilities/*.json` with `remote.urls`; v1's `dangerousRemoteDomainIpcAccess` is gone |
| JS `download()` never yields bytes | kept in a Rust `Resource`; only Rust's `Update::download()` returns `Vec<u8>` |
| Toolchain present | `cargo 1.95.0`, `cargo build` exit 0, WebView2 `152.0.4191.66` |

## Goals / Non-Goals

**Goals.** Delete Electron's role without deleting a single capability. One UI, one backend.
Existing data directory, database and encrypted secrets survive. Windows is *built and run*;
macOS/Linux are configured and honestly labelled.

**Non-Goals.** No Rust rewrite of the backend. No claim that installation is removed. No
notarization. No macOS/Linux artefacts published from a host that cannot build or test them.

## Decisions

### D1 — The backend stays Node, spawned as a bundled sidecar

Rewriting ~50k lines of working Node into Rust would be a rewrite for no user-visible gain, and
was explicitly not asked for.

The runtime is bundled rather than assumed: the operator must not install Node. Tauri's
`bundle.externalBin` declares `binaries/node`, resolved at build time from
`node-<target-triple>.exe`.

*Rejected:* Node SEA. It compiles a single script into one binary, but the backend relies on
dynamic `await import()` and on reading files relative to its own location; SEA restricts both.

### D2 — The shell spawns the **service** entry and awaits the **real** readiness line

The existing sidecar spawns the Electron entry — under `node` that dies immediately. It also
waits for `"Server running at"`, a line this backend has never printed, so readiness could only
ever be satisfied by the port fallback.

Decision: spawn `dist/src/main/index.js`; treat `[antidetect] Local API listening on http://…`
**or** an accepting port as ready. The port check stays as the second signal because a
readiness line is only useful if its stdout is actually captured.

The backend additionally emits one machine-readable readiness line so the shell is not matching
prose. That is a one-line addition to the service, not a new protocol.

### D3 — The native bridge is injected by the shell; the renderer is untouched

The renderer calls `window.antidetect.*` and already tolerates its absence. Two options were
available: edit the renderer to speak Tauri commands directly, or have the shell provide the same
namespace.

Decision: **provide the namespace.** The shell injects an initialization script defining
`window.antidetect` with the same shape, backed by Tauri commands. Consequences: zero renderer
diff → the web interface stays byte-identical for browser users (R15i), `hasNativeWindow` keeps
working, and the migration cannot break the UI.

Tauri v2 forbids `invoke` from a remote origin unless a capability explicitly allows it
(`remote.urls`). The capability is therefore a hard requirement, not a detail — without it the
bridge silently does nothing.

### D4 — Screen protection: core facility for capture, Win32 for the rest

Tauri core exposes content protection (`set_content_protected` → `SetWindowDisplayAffinity` with
`WDA_EXCLUDEFROMCAPTURE` on Windows, `NSWindowSharingType::None` on macOS), which replaces
`BrowserWindow.setContentProtection` directly.

Idle time and power/session events have **no** core or official-plugin equivalent, so they are
implemented in Rust on Windows: `GetLastInputInfo` for measured idle, `WM_POWERBROADCAST` for
suspend/resume, `WTSRegisterSessionNotification` + `WM_WTSSESSION_CHANGE` for session lock.

*Rejected:* approximating idle with a timer started at launch — that measures uptime, not
idleness, and would lock a window the operator is actively using.

### D5 — Updates: platform updater for transport, Rust for verification

The plugin's **JS** `download()` returns `void` and keeps bytes in Rust; only a path-less
`Resource` remains. The existing `verifyUpdateBeforeApply` takes a **file path**. Those two
cannot be joined in JavaScript.

Decision: the update flow runs in **Rust** — `Update::download()` → `Vec<u8>` → independent
verification against the signed manifest and keyring → `Update::install(&bytes)`. JS receives
only status events through the existing `update:status` channel, so `Settings.tsx` is unchanged.

This keeps both barriers: Minisign (mandatory in the plugin) and the project's own Ed25519
manifest + monotonic anti-rollback check.

*Rejected:* JS `downloadAndInstall()` — it installs whatever the transport delivered, with no
place to interpose the project's own verification. That would delete a capability the project
built and tested (R07).

### D6 — Portable artefact self-updates by replacing itself

`tauri-plugin-updater` installs *installed* builds; a single-file portable has no installer to
run. R09 requires the portable file to update itself.

Decision: the shell performs its own replace — download to a temporary file beside the artefact,
verify, then swap. Windows forbids overwriting a running executable, so the swap is performed by
a helper invocation after the current process releases the file, and the operator is told to
restart. On any failure the running artefact stays intact.

This is recorded as the riskiest deliverable; if it cannot be made safe it is reported as a gap.

### D7 — Keyring must ship

`resolveKeyRing` currently falls back to an **empty** keyring because
`resources/release-keyring.json` is not in the repository — so `verifyUpdateBeforeApply` refuses
every update it is shown. That defect predates this change, but the rewritten path inherits it,
so the keyring is made an explicit release output and its path resolvable at runtime.

An empty keyring stays a **refusal**, never a pass.

### D8 — Electron is demoted, then deleted one release later

R05: the shell becomes primary while Electron remains in the tree; the deletion happens once the
shell is proven. The cutover is clean at that point — `electron/`, `dist/electron`, the Electron
dependencies, `afterPack-adhoc-sign.cjs` and the Electron-oriented tests all go, with no
compatibility shims left behind.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **DPAPI compatibility** — a wrong implementation silently loses proxy passwords | Verified by decrypting a value produced by the current build, not by reasoning about flags |
| **Portable self-update** — replacing a running `.exe` is inherently awkward | Swap-after-exit, artefact left intact on failure, reported as a gap if not provably safe |
| **Empty keyring** — pre-existing, now load-bearing | Ship the keyring; test that empty ⇒ refusal |
| **Remote IPC capability** — easy to omit; failure is silent | Asserted by a test, since a missing capability produces no error, just a dead bridge |
| **macOS/Linux unverifiable here** | Configuration only, no artefacts published; stated in README and CHANGELOG |
| **Two desktop builds for one release** | Bounded by R05; Electron's deletion is the last task |

## Migration

1. Backend drops its Electron globals (resources path, screen protection, DPAPI) — the shell does
   not exist yet, so this lands with the directory contract and the fallback chain intact.
2. Shell grows: sidecar → readiness → bridge → tray/single-instance/dialogs.
3. Updates and screen protection land in Rust.
4. Packaging: node sidecar, portable target, macOS/Linux config.
5. Verify on Windows by running the shell; then retire the Electron-oriented tests and, one
   release later, Electron itself.

Data is never migrated: `DATA_DIR` stays `%APPDATA%\antidetect-browser`, the database stays put,
and encrypted values stay readable — verified, not assumed.

## Open Questions

- The **portable self-update swap** mechanism needs a concrete, testable implementation before it
  can be called done; if the helper approach cannot be proven, the fallback is an in-place
  download-and-notify flow reported as a partial.
- `latest.json` must carry per-platform signatures; only the Windows key can be produced here.
  macOS/Linux entries are configured but unverifiable until those runners exist.
