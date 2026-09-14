## Why

The user asked for a Tauri-on-Rust interface, and chose to do it **after** the web path
works. That ordering was right, and the reason is worth restating because it is easy to
misremember: **Tauri does not remove installation.** A Tauri app is still an `.app` or a
`.dmg`, and an unsigned one still hits macOS quarantine. What removed installation was
serving the renderer over HTTP, which is already done and verified.

What Tauri adds is a smaller, native-shelled desktop build over the *same* interface —
no Electron runtime, a webview the OS already ships, and a materially smaller artefact.
That is a real benefit and it is worth having; it is just not the benefit the original
request was reaching for.

## What Changes

- **A thin Tauri shell** whose only jobs are: open a webview on the served UI, start the
  Node backend as a sidecar, and close it on exit. It reimplements nothing.
- **The backend stays Node.** The renderer is already HTTP-only and the API, MCP server,
  script engine, teams sync and kernel acquisition all live there. Rewriting that into
  Rust would be a rewrite of a working system for no user-visible gain, and it is not
  what was asked for.
- **Sidecar lifecycle**: launch the backend, wait for its readiness signal, then point
  the webview at it; on exit, terminate it. A failed backend must produce a legible
  window rather than a blank one.

## Capabilities

### New Capabilities
- `tauri-shell`: a native window over the existing served interface, with sidecar lifecycle.

### Modified Capabilities

None — the application itself is unchanged; this is another way to open it.

## Impact

- New `src-tauri/` (Rust shell, `tauri.conf.json`, sidecar wiring), packaging config,
  CI job for the Tauri artefacts.
- Tests: sidecar readiness and teardown logic, and a configuration assertion that the
  shell points at the served UI rather than embedding a second copy of it.

### Goals

- A materially smaller desktop artefact than the Electron build, over the same UI.
- One UI, one backend: no second implementation of either.
- Sidecar start/stop is robust — no orphaned backend process after the window closes.

### Non-Goals

- **No Rust rewrite of the backend.** The user asked for a Tauri interface, not a new
  server; Node stays.
- No claim that this removes installation or signing (R93i). The manifest and the
  documentation must say plainly that the web path is what does that.
- No replacement of the Electron build in this wave — it stays until the shell is proven.

### Risks and commitments

- **The Tauri CLI is not installed and `cargo install` needs network and time.** If the
  environment cannot fetch it, the shell can still be scaffolded and its configuration
  and lifecycle logic tested; *building* it may have to happen in CI. That must be
  stated as a limitation rather than papered over.
- **Sidecar teardown is the classic failure.** A window that closes while the backend
  keeps running leaves a port bound and a process the operator cannot see. Teardown is
  the part that needs the most care and the most testing.
- **Two desktop builds is a maintenance cost.** Until the Tauri shell is proven on all
  three platforms, Electron remains the supported desktop artefact.
