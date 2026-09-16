# Proposal — Retire Electron, ship the Tauri shell as the desktop build

## Why

The desktop build is an Electron wrapper around a backend that never needed Electron.
Measured, not assumed:

- `node dist/src/main/index.js` starts the whole service — API, MCP server, script engine,
  teams sync, kernel acquisition — with **no Electron at all**. The backend is Node.
- The renderer is HTTP/WebSocket-only. It reaches the backend over `fetch`; the only
  Electron-shaped surface it touches is the `window.antidetect` bridge, and it already
  degrades gracefully when that bridge is absent (`hasNativeWindow` guard in `App.tsx`).
- Electron's actual footprint is ~300 lines in `electron/main.ts` + `preload.ts` providing
  five things: a frameless window, native folder dialogs, tray, auto-update, and a DPAPI
  cipher. That is the entire thing being replaced.

So Electron is being paid for — ~150 MB of bundled Chromium and a second copy of a browser
engine in RAM — to provide a window, a tray icon and a dialog box.

`src-tauri/` already exists but is **broken and unproven**:

- it spawns `dist/electron/main.js`, i.e. the Electron entry, under plain `node` — which
  dies immediately on `electron-updater` (`this.app.getVersion()` of undefined);
- it waits for a readiness line `"Server running at"` that the backend **never prints**. The
  real line is `[antidetect] Local API listening on http://…`;
- it has no capability manifest, so the remote page could not call `invoke` even if the
  webview loaded.

This change makes the shell real and demotes Electron.

## What Changes

- **The shell runs the backend, not the Electron entry.** It spawns the bundled Node runtime
  against `dist/src/main/index.js` and waits for the line the backend actually emits.
- **The `window.antidetect` bridge is provided by the shell, not by the renderer.** The shell
  injects an initialization script that defines the same namespace with the same method
  shapes, backed by Tauri commands. `App.tsx`, `Settings.tsx` and `api.ts` are **not edited** —
  the web interface stays byte-identical for browser users too.
- **Backend loses its last Electron globals.** `process.resourcesPath` (kernel/chromedriver
  lookup), `require('electron')` (screen protection) and `safeStorage` (DPAPI) are replaced by
  a directory contract passed in the environment and by Rust-side implementations.
- **Screen protection moves to Rust**: Tauri core `set_content_protected` plus Win32
  `GetLastInputInfo` / `WM_POWERBROADCAST` / `WTSRegisterSessionNotification` for idle,
  suspend and session-lock parity on Windows.
- **Updates**: `tauri-plugin-updater` (Minisign, mandatory) **plus** the existing signed
  manifest + keyring check, which must move into Rust because the plugin's JS `download()`
  never hands the artefact bytes to JavaScript.
- **Packaging**: Node bundled as a Tauri sidecar; the Windows portable single-file `.exe` is
  preserved and gains self-update.
- **Electron is removed one release later** — it stays in the tree as the fallback until the
  shell is proven, then `electron/`, `dist/electron`, the Electron dependencies and the
  Electron-oriented scripts and tests are deleted.

## Capabilities

### New Capabilities
- `tauri-desktop-shell` — window, sidecar lifecycle, native bridge, tray, single instance.
- `desktop-updates` — Tauri updater plus independent signed-manifest verification.
- `desktop-secrets` — DPAPI cipher provided by the shell, preserving existing `enc:` values.

### Modified Capabilities
- `screen-capture-protection` — implementation moves from Electron to Rust; Windows parity kept,
  macOS/Linux limited to capture exclusion.
- `portable-distribution` — portable becomes a Tauri single-file artefact with self-update.

## Impact

- `src-tauri/` grows from a stub into the real shell (Rust + capabilities + bundle config).
- `src/main/config.ts`, `src/main/security/screenProtection.ts`, `src/main/util/secretStore.ts`
  lose their Electron dependencies.
- `package.json` build scripts move off `electron-builder`; CI gains a Tauri job that replaces
  the Electron release job once the shell is proven.
- Tests: Electron-oriented config assertions (`framelessWindow`, `portableTargets`,
  `macosPackaging`) are superseded by shell assertions; the sidecar lifecycle keeps its tests,
  corrected against the real readiness signal.

## Goals

- A materially smaller desktop artefact over the **same** UI and the **same** backend.
- No second implementation of UI or backend — one interface, one service (R15i).
- No orphaned backend process on any exit path.
- Existing installations keep their data directory, database and encrypted secrets.

## Non-Goals

- **No Rust rewrite of the backend.** Node stays; the shell is a window plus native glue.
- No claim that the shell removes installation. The web path is what does that.
- No notarization — there is no Apple Developer account, and ad-hoc signing is the ceiling.
- No macOS/Linux **artefacts** in this wave: configuration only, because neither can be built
  or run on this host (R10).

## Risks and commitments

- **Removing Electron from the backend is the part that can silently corrupt user state.**
  `safeStorage`→DPAPI must decrypt existing `enc:` values; a wrong implementation loses saved
  proxy passwords. It is verified against values written by the current build, not by reasoning.
- **`resolveKeyRing` currently returns an empty keyring** — no `resources/release-keyring.json`
  is in the repo — so the existing verification refuses every update. That defect predates this
  change but becomes load-bearing once the path is rewritten (R07) and is fixed here.
- **Portable self-update is the riskiest deliverable** (R09): the plugin installs *installed*
  builds; a self-replacing single-file needs its own download, verification and swap. If it
  cannot be made safe, it is reported as a gap rather than faked.
- **Two desktop builds is a maintenance cost** for exactly one release (R05), after which
  Electron is deleted.
