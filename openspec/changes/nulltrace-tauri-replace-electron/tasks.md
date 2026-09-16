# Tasks — Retire Electron, ship the Tauri shell

Order: backend contract → shell core → native → updates → packaging → verification → Electron removal.
Every task names the requirement(s) it discharges. A task tracing to no requirement is work nobody ordered.

Suite baseline: **124 files / 994 passed, 1 skipped**. It MUST stay green through every wave.

---

## 1. Backend loses its last Electron globals (zone B)

- [x] 1.1 `config.ts`: replace `process.resourcesPath` with `targetResourcesDir()` reading
      `ANTIDETECT_TARGET_RESOURCES_DIR` (interfaces §B1). `kernelBaseDirs()` and
      `getChromedriverPath()` keep their signatures and both search sources. → **R01, R17i**
- [x] 1.2 `security/screenProtection.ts`: delete all three `require('electron')` branches. With no
      seams installed the calls become reported no-ops that do not throw. Signatures unchanged so the
      shell and the tests both keep their existing call shape. → **R01, R06**
- [x] 1.3 `util/secretStore.ts`: no source change to the format (`enc:`/`aes:`/`plain:` stay a
      compatibility contract). Verify `setSecretCipher` is the only injection point a non-Electron
      host needs, and that `revealSecret` on an `enc:` value with no cipher reports rather than
      returning a partial. → **R12, R14i**
- [x] 1.4 NEW `api/routes/dataDir.ts`: port the `data:*` logic from `electron/main.ts` to
      authenticated HTTP endpoints (interfaces §B4) — including the `finally` that always re-opens
      the DB and re-seeds devices. Mount in `server.ts`. → **R13i, R14i**
- [x] 1.5 Confirm the readiness line stays exactly
      `[antidetect] Local API listening on http://<host>:<port>`; do **not** add a second one. → **R18i**
- [x] 1.6 NEW `api/routes/shutdown.ts`: `POST /api/v1/shutdown` (authenticated) invoking the existing
      `shutdown('shell-exit')` from `src/main/index.ts`. Respond first, then exit, so the caller is not
      left with a dead socket. This is what lets the shell stop the backend gracefully instead of
      force-killing it (interfaces §B5). Mount below `authMiddleware`. → **R01, R14i**

## 2. Shell core (zone S1)

- [x] 2.1 `Cargo.toml`: add `tauri-plugin-single-instance`, `tauri-plugin-dialog`,
      `tauri-plugin-opener`, `tauri-plugin-updater`, `tauri-plugin-process`, `tauri-plugin-shell`;
      tray feature enabled; release profile set for a small binary. → **R01**
- [x] 2.2 `tauri.conf.json`: `frontendDist` = the served URL; window frameless
      (`decorations:false`), 1280×800, title `NullTrace`; `identifier` = `com.antidetect.browser`
      (**unchanged** — it is the product identity an existing install is recognised by);
      `withGlobalTauri: true`; bundle `externalBin` declares the node sidecar.
      The window points at the **served** interface — no bundled renderer copy. → **R01, R14i, R04, R15i**
- [x] 2.3 `capabilities/remote-ui.json` per interfaces §E. Without it the remote page's IPC is
      silently denied and the bridge does nothing. → **R13i**
- [x] 2.4 `sidecar.rs`: spawn `dist/src/main/index.js` with the **bundled** node path, and set
      `ANTIDETECT_SETTINGS_DIR` to the Electron-era `%APPDATA%\antidetect-browser`, plus
      `ANTIDETECT_TARGET_RESOURCES_DIR`. Never spawn `dist/electron/main.js`. → **R01, R04, R13i, R14i**
- [x] 2.5 `sidecar.rs`: readiness matches the **real** line (interfaces §A) or a bound port; remove
      `"Server running at"` entirely. Keep the early-exit and timeout paths legible. → **R18i**
- [x] 2.6 `main.rs`: resolve the bundled node runtime, start the sidecar, await readiness, navigate
      the webview at the served UI, install the injected bridge script, register tray +
      single-instance + dialog/opener commands, and run teardown on **every** exit route.
      A failed backend shows the failure page, never a window pointed at nothing. → **R01, R04, R18i**
- [x] 2.6a Teardown MUST ask the backend to stop before force-killing it: `POST /api/v1/shutdown`
      (interfaces §B5) → wait bounded (~5 s) for exit → only then `taskkill /T /F`. Windows does not
      deliver the `SIGTERM` the backend's `shutdown()` listens for, so a first-move force-kill skips
      `flushDb()`/`closeDb()`/`releaseInstanceLock()` — risking an unflushed DB, orphaned Chromium
      profiles and a stale `service.lock` that the next launch reads as a crash. → **R01, R14i**
- [x] 2.6b A backend bootstrap failure MUST also produce a native error dialog, matching the previous
      `dialog.showErrorBox` path (`electron/main.ts:373`), in addition to the in-window failure page —
      a window the operator never sees is not a report. → **R01**
- [x] 2.7 Register the commands the bridge calls: `get_api_key`, `open_path`, `pick_directory`,
      plus the update commands wired in §4. `get_api_key` reads `DATA_DIR/api_key` from the same
      settings dir the sidecar uses. → **R13i**

## 3. Native: screen protection and secrets (zone S2)

- [x] 3.1 `secrets.rs`: DPAPI `CryptProtectData`/`CryptUnprotectData`, **CurrentUser scope** (no
      `CRYPTPROTECT_LOCAL_MACHINE`). Register as a Tauri command; the shell calls
      `setSecretCipher` on the backend with it. → **R12**
- [x] 3.2 `secrets.rs`: **prove compatibility** — decrypt a value produced by the *current* build's
      `safeStorage` and confirm the plaintext matches. This is the difference between claiming
      compatibility and having it. Note the format measured here: `safeStorage` on Windows is
      AES-256-GCM under a `v10` prefix with a key stored DPAPI-wrapped in `Local State`, so the
      cipher the shell injects must reproduce **that**, not raw DPAPI over the payload. → **R12**
- [x] 3.3 `screen.rs`: capture exclusion via Tauri core `set_content_protected`, toggled from the
      persisted `captureProtection` setting. Works on Windows and macOS. → **R06, R11**
- [x] 3.4 `screen.rs` (Windows): measured idle via `GetLastInputInfo`, suspend/resume via
      `WM_POWERBROADCAST`, session lock via `WTSRegisterSessionNotification` +
      `WM_WTSSESSION_CHANGE`. Lock conceals the window; `idle_timeout_minutes == 0` disables idle
      locking and MUST NOT disable suspend/lock engagement. → **R06, R11**
- [x] 3.5 `screen.rs` (non-Windows): capture exclusion implemented; idle and lock are explicit
      documented no-ops, not silently missing. → **R11**
- [x] 3.6 `tray.rs`: tray with Show/Quit, left-click toggles the window, close hides **only when
      the tray exists**; a failed tray creation MUST make close exit instead of stranding the app. → **R01**

## 4. Updates (zone S3)

- [x] 4.1 `updater.rs`: `tauri-plugin-updater` with the Minisign public key in config; check /
      download / install driven from Rust, status emitted camelCase on `update:status`. → **R07**
- [x] 4.2 `updater.rs`: verification runs **on the artefact bytes** between `download()` and
      `install(bytes)`. `Update::download()` already returns `Vec<u8>` in Rust — this is why the flow
      is Rust-side. A failed verification MUST refuse install and leave the running version intact. → **R07**
- [x] 4.3 Signed-manifest + keyring + monotonic anti-rollback verification ported to Rust, keeping
      the same rules as `verifyUpdateBeforeApply` (equal or older version refused; empty keyring
      refuses; refusal logged). → **R07**
- [x] 4.4 **Fix the pre-existing keyring defect**: `resources/release-keyring.json` does not exist,
      so the keyring resolves empty and every update is refused. Ship the keyring and make its path
      resolvable at runtime. An empty keyring stays a refusal, never a pass. → **R07**
- [x] 4.5 `portable_self_update`: download beside the artefact → verify → swap after the running
      process releases the file; tell the operator a restart is required; a failure leaves the
      running artefact intact and is reported. → **R09**
- [x] 4.6 Release metadata in the format the platform updater consumes, with the artefact signature
      published alongside (`latest.json` with per-platform entries + `.sig`). → **R07**

## 5. Packaging (zone P)

- [x] 5.1 `scripts/vendor-node.mjs`: place the Node runtime as
      `src-tauri/binaries/node-<target-triple>.exe`. Pin a version and verify a checksum; do not
      download a floating latest. → **R04**
- [x] 5.2 Windows: build an **NSIS-backed portable single-file** artefact that keeps
      `PORTABLE_EXECUTABLE_DIR` meaningful, plus the installer. Distinct self-describing names; the
      kernel is **not** bundled. → **R03, R17i**
- [x] 5.3 macOS arm64: `signingIdentity: "-"` (ad-hoc, required by the Apple Silicon loader) and
      Linux targets configured. **Configuration only — no artefacts published** (R10), because
      neither can be built or run on this host. → **R08, R10, R16i**
- [x] 5.4 `package.json` build scripts move to the Tauri pipeline; Electron scripts stay for one
      release as the fallback (R05) and are marked as such. → **R05**
- [x] 5.5 CI: a Tauri job that builds and tests the shell on Windows; macOS/Linux jobs present but
      not publishing. The Electron release job keeps working until the shell is proven. → **R05, R10**

## 6. Verification (zone X)

- [x] 6.1 Retire Electron-oriented assertions that no longer describe reality
      (`framelessWindow`, and the Electron halves of `portableTargets` / `macosPackaging`) and replace
      them with shell equivalents — **only where the new assertion defends an observable contract**,
      never to re-pin superseded text.
- [x] 6.2 Sidecar tests corrected against the real readiness signal, plus a test that the spawned
      entry is the **service** entry and not the Electron one.
- [x] 6.3 A test that the remote capability exists and names the served origin — a missing capability
      fails silently, so nothing else would catch it.
- [x] 6.4 Bridge-shape test: the injected script defines every method the renderer calls, with the
      signatures it calls them with. → **R13i**
- [x] 6.4a A test asserting `src/renderer/**` was not modified by this change — R13i is a claim about
      absence, and absence is exactly what a diff check can prove. → **R15i**
- [x] 6.5 Build and **run** the shell on Windows: window opens on the served UI, window controls work,
      tray appears, close hides, quit tears the backend down with no orphan and no bound port.
- [x] 6.6 Full suite + typecheck green; `cargo test` green.
- [x] 6.7 Docs: README (Tauri is the desktop build; honest install/signing/macOS/Linux limits),
      CHANGELOG, and `docs/DECISIONS.md` — a new ADR superseding ADR-005's Electron choice, recording
      the audited inventory of what Electron actually provided and what replaced each part. → **R02**

## 7. Electron removal — one release later (R05)

- [x] 7.1 Delete `electron/`, `dist/electron`, the Electron dependencies
      (`electron`, `electron-builder`, `electron-updater`), and `scripts/afterPack-adhoc-sign.cjs`.
- [x] 7.2 Remove the Electron branch from CI and from `package.json`. No shims, aliases or
      compatibility re-exports survive the cutover.
- [x] 7.3 Re-verify: suite green, shell still builds and runs, no dangling reference to a deleted path.

## 8. Deferred (recorded, not scheduled)

- [ ] 8.1 macOS/Linux artefacts built and published — needs runners that can build and test them (R10).
- [ ] 8.2 macOS/Linux idle + session-lock parity — needs platform implementations this host cannot verify (R11).
- [ ] 8.3 Notarization — no Apple Developer account; ad-hoc signing is the ceiling (R16i).
- [ ] 8.4 Rewriting the backend in Rust — explicitly not asked for and not planned.
