# Tasks — nulltrace-tauri-shell

Order: scaffold → sidecar lifecycle → packaging → CI → verification.
Suite stays green (122 files / 969 tests) and typecheck clean throughout.

## 1. Scaffold (no CLI required)

- [x] 1.1 `src-tauri/` with `Cargo.toml`, `tauri.conf.json`, `build.rs` and a minimal
      `main.rs`. **Do not require the Tauri CLI to scaffold** — the CLI is not installed
      here and `cargo install tauri-cli` needs network and several minutes. The crate
      and its config can be written directly; building is a separate step.
- [x] 1.2 `tauri.conf.json` points the window at the served UI. It must **not** embed a
      second copy of the renderer — that would create a second UI to keep in sync.
- [x] 1.3 Keep `identifier` aligned with the existing `appId` (`com.antidetect.browser`)
      so the two desktop builds are recognisably the same product and an existing
      installation is not orphaned.

## 2. Sidecar lifecycle (the part that actually needs care)

- [x] 2.1 Launch the Node backend as a sidecar on startup: resolve the node binary or a
      packaged runtime, pass the same environment the service already understands
      (`API_PORT`, `ANTIDETECT_DATA_DIR`), and keep the child handle.
- [x] 2.2 **Wait for readiness, do not guess.** The service prints a readiness line; the
      shell must wait for it (or for the port to accept) before pointing the webview at
      it. A fixed sleep is not acceptable.
- [x] 2.3 A backend that fails to start must produce a legible window explaining that,
      not a blank webview pointed at nothing.
- [x] 2.4 Teardown on every exit path — normal close, window close, and process
      termination. An orphaned backend leaves a bound port and an invisible process.
- [x] 2.5 Test the lifecycle logic in isolation: readiness detection, the failure path,
      and teardown being called on each exit route.

## 3. Packaging

- [x] 3.1 Tauri bundle config for Windows, Linux and macOS arm64, mirroring the existing
      portable artefacts' naming so a user can tell them apart.
- [x] 3.2 The macOS bundle stays **unsigned** (`identity: null` equivalent). No Apple
      Developer account exists; state it in the docs.
- [x] 3.3 Document, plainly, that **this does not remove installation** — it is still an
      `.app`/`.dmg`/`.msi`, and the web path is what removed installation. The original
      request conflated the two; the docs must not repeat that.

## 4. CI

- [x] 4.1 A job that installs the Tauri CLI and builds the shell per platform. The
      Electron release job stays — this is additive until the shell is proven.
- [x] 4.2 Do not make the Tauri job a release blocker while it is unproven. Report its
      result without gating the existing artefacts on it.

## 5. Verification

- [x] 5.1 Full suite green, typecheck clean, `cargo test` green for the shell crate.
- [x] 5.2 If the Tauri CLI can be installed and a build produced in this environment,
      run it and say what was observed. **If it cannot, say exactly that** — do not
      imply a build that did not happen.
- [x] 5.3 CHANGELOG entry that describes the shell honestly, including that Electron
      remains the supported desktop build until this is proven.
- [x] 5.4 Record in the final report that the web path, not the shell, is what satisfies
      the original "no installer" requirement (R93i).

## 6. Deferred (recorded, not scheduled)

- [ ] 6.1 Replacing the Electron desktop build with the shell — pending cross-platform proof.
- [ ] 6.2 Migrating the backend to Rust — explicitly not asked for and not planned.
- [ ] 6.3 macOS notarization — no Apple Developer account (R92).
