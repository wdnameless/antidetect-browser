# Interfaces — retires Electron for the Tauri shell

Frozen before any parallel work. Every zone codes against these signatures; changing one after
launch breaks another zone's build.

---

## A. Shell → backend environment contract

The shell spawns the backend with exactly these, and no others:

| Variable | Value | Why it exists |
|---|---|---|
| `ANTIDETECT_SETTINGS_DIR` | `%APPDATA%\antidetect-browser` | **MUST be the Electron-era path**, not Tauri's `%APPDATA%\<identifier>`. `settings.json`, `dataDir`, `panel_auth.json`, `panel_sessions.json` and **`Local State`** (the DPAPI-wrapped AES key) all live there. Tauri's default would orphan them. |
| `ANTIDETECT_DATA_DIR` | pass-through if set by the operator | existing override, unchanged |
| `ANTIDETECT_TARGET_RESOURCES_DIR` | **NEW.** Directory holding bundled non-kernel resources (`chromedriver/`) | replaces `process.resourcesPath`, which does not exist outside Electron |
| `API_PORT` / `API_HOST` | `50325` / `127.0.0.1` | existing |
| `PORTABLE_EXECUTABLE_DIR` | set only by the portable launcher | preserved contract for relocatable data |

**Readiness (R18i).** The backend prints, and the shell matches:

```
[antidetect] Local API listening on http://<host>:<port>
```

already emitted by `startApi()` in `src/main/api/server.ts`. The shell accepts this line **or** a
TCP connection on the port. The string `"Server running at"` that `sidecar.rs` currently waits for
appears nowhere in the backend and MUST be removed.

---

## B. Backend module contract (`src/main/`)

### B1. `config.ts`

```ts
// Replaces `process.resourcesPath` (Electron-only global).
export function targetResourcesDir(): string | null;   // NEW
export function kernelBaseDirs(): string[];            // signature unchanged
export function getChromedriverPath(): string | null;  // signature unchanged
```

`kernelBaseDirs()` keeps both sources: the bundled resources dir first, `CHROMIUM_DIR` fallback.
`getChromedriverPath()` keeps `CHROMEDRIVER_PATH` → resources dir → data dir.

### B2. `security/screenProtection.ts`

```ts
export interface ScreenProtectionSeams {          // unchanged shape
  setContentProtection(value: boolean): void;
  getSystemIdleTime(): number;
  on(event: 'lock-screen' | 'suspend' | 'resume' | 'unlock-screen', handler: () => void): void;
}
export function setSeams(s: ScreenProtectionSeams | null): void;
export function initScreenProtection(options?: { idleTimeoutMinutes?: number }): void;
export function setCaptureProtection(enabled: boolean): void;
export function engageLock(): void;
export function unlock(token: string): void;
export function isLocked(): boolean;
export function getScreenState(): Readonly<{ captureProtection: boolean; idleTimeoutMinutes: number; locked: boolean }>;
export function resetScreenState(): void;
```

**Change:** every `require('electron')` branch is deleted. When `seams === null` the call is a
**no-op that reports the absence** — it MUST NOT throw. The shell installs real seams; tests install
fakes. No Electron fallback survives.

### B3. `util/secretStore.ts`

```ts
export interface SecretCipher { encrypt(plain: string): Buffer; decrypt(data: Buffer): string; }  // unchanged
export function setSecretCipher(c: SecretCipher): void;   // unchanged — the shell injects DPAPI here
export function hasSecretCipher(): boolean;               // unchanged
export function protectSecret(plain?: string | null): string | null;   // unchanged: enc: → aes: → plain:
export function revealSecret(stored?: string | null): string | undefined;
```

Unchanged on purpose: the on-disk format (`enc:`/`aes:`/`plain:`) is a compatibility contract.

### B4. `api/routes/dataDir.ts` — NEW

Electron's `data:*` IPC handlers carried real logic (stop browsers, flush and re-open the DB,
recursive copy). That logic has to live somewhere that owns the launcher and the DB, so it moves to
the backend and is reached over the authenticated HTTP API.

```ts
// All require Bearer auth (mounted below authMiddleware).
GET  /api/v1/data/dir                       → { code:0, data:{ dir: string } }
POST /api/v1/data/dir            { dir }     → { code:0, data:{ ok:true, dir } }   // persist; applies after restart
POST /api/v1/data/migrate        { target, migrateData: boolean }
                                             → { code:0, data:{ ok:true, dir, migrated } }
                                             → { code:-1, msg, data:{ ok:false, dir, error } }
POST /api/v1/data/check-dir      { dir }     → { code:0, data:{ ok:boolean, dir } }
```

`/data/migrate` is a faithful port: `stopAll()` → `flushDb()` → `closeDb()` → copy with the same
exclusions (`.tmp`, `service.lock`, `.restore-tmp`) → persist → **always** re-`initDb()` +
`seedDevices()` in a `finally`, including on failure.

### B5. `POST /api/v1/shutdown` — graceful stop, so teardown is not a force-kill

**Why this exists.** The backend already has `shutdown()` in `src/main/index.ts` (stop all browsers →
session cleanup → `flushDb()` + `closeDb()` → `releaseInstanceLock()`), wired to `SIGINT`/`SIGTERM`.
Windows does **not** deliver `SIGTERM` from `taskkill`, so a shell that force-kills the child skips all
of it — leaving a possibly-unflushed SQLite file, orphaned Chromium profiles, and a stale
`service.lock` that the next launch must treat as crash recovery. Electron avoided this by running
`stopAll()` + `flushDb()` in `before-quit`, in the same process.

The shell therefore stops the backend the way the backend can actually hear:

```ts
POST /api/v1/shutdown        (Bearer auth)   → { code:0, data:{ ok:true } }  then exits
```

It calls the existing `shutdown('shell-exit')`. Ordering the shell MUST use:

1. `POST /api/v1/shutdown`, then wait (bounded, ~5 s) for the child to exit.
2. Only if it has not exited: force-kill the tree (`taskkill /T /F`).

The forced kill stays as the last resort — it must never be the first move.

Folder **selection** stays in the shell (a native dialog is not an HTTP concern).

---

## C. Rust module contract (`src-tauri/src/`)

One crate, one compilation unit. Modules are separate files with frozen signatures so they can be
written in parallel and integrated by one build.

```rust
// sidecar.rs  — owns the backend process
pub struct SidecarConfig {
    pub port: u16,
    pub data_dir: Option<String>,
    pub settings_dir: String,        // NEW: ANTIDETECT_SETTINGS_DIR
    pub resources_dir: Option<String>, // NEW: ANTIDETECT_TARGET_RESOURCES_DIR
    pub node_path: String,           // bundled runtime, resolved by main.rs
    pub script_path: String,         // MUST be dist/src/main/index.js
    pub readiness_timeout: Duration,
    pub readiness_signal: String,    // MUST be "[antidetect] Local API listening on"
}
pub enum ReadinessStatus { ReadySignalObserved, PortBoundObserved, TimedOut, ProcessExitedEarly(Option<i32>) }
impl SidecarProcess {
    pub fn spawn(config: SidecarConfig) -> std::io::Result<Self>;
    pub fn from_child(child: Child, config: SidecarConfig) -> Self;
    pub fn wait_for_readiness(&mut self) -> ReadinessStatus;
    pub fn terminate(&mut self) -> std::io::Result<()>;   // idempotent
    pub fn ui_url(&self) -> String;
    pub fn failure_html(err: &str) -> String;
    pub fn is_terminated(&self) -> bool;
}
pub fn check_port_open(port: u16) -> bool;
```

```rust
// screen.rs — capture exclusion + Win32 idle/power/session parity (Windows)
pub struct ScreenOptions { pub idle_timeout_minutes: u32 }
pub fn init(app: &tauri::AppHandle, opts: ScreenOptions) -> Result<(), String>;
pub fn set_capture_protection(app: &tauri::AppHandle, enabled: bool) -> Result<(), String>;
pub fn engage_lock(app: &tauri::AppHandle);
pub fn unlock(app: &tauri::AppHandle);
pub fn is_locked() -> bool;
// Windows: GetLastInputInfo, WM_POWERBROADCAST, WTSRegisterSessionNotification.
// Non-Windows: init/set_capture_protection implemented; idle/lock are explicit no-ops.
```

```rust
// secrets.rs — DPAPI. Replaces electron.safeStorage.
pub fn dpapi_encrypt(plain: &str) -> Result<Vec<u8>, String>;
pub fn dpapi_decrypt(blob: &[u8]) -> Result<String, String>;
pub fn is_available() -> bool;
```

```rust
// tray.rs
pub fn init(app: &tauri::AppHandle) -> Result<(), String>;
// Creates the tray with Show/Quit. Left click toggles the window.
// Returns Err when the icon or tray could not be created — main.rs MUST then
// allow close to exit rather than stranding the app hidden with no tray.
```

```rust
// updater.rs — transport via tauri-plugin-updater, verification in Rust
pub enum UpdateState {
    Checking, Available { version: String }, NotAvailable, Downloading { percent: f64 },
    Downloaded { version: String }, Error { message: String },
}
pub fn init(app: &tauri::AppHandle) -> Result<(), String>;
pub fn check(app: &tauri::AppHandle);
pub fn download(app: &tauri::AppHandle);
pub fn install(app: &tauri::AppHandle);
// Mandatory order: Update::download() -> Vec<u8> -> verify_signed_manifest(bytes)
// -> only then Update::install(&bytes). A failed verification MUST refuse install.
pub fn verify_artifact(bytes: &[u8], version: &str, keyring_path: &Path) -> Result<(), String>;
pub fn portable_self_update(app: &tauri::AppHandle) -> Result<(), String>;
```

`UpdateState` is serialized camelCase and emitted on the `update:status` event — the same channel
and shape `Settings.tsx` already listens for.

### C1. Update flow ordering (the part that must not be shortcut)

The plugin's JS `download()` returns `void` and keeps bytes in a Rust `Resource`, so verification
**cannot** happen in JavaScript. The flow is therefore Rust-side end to end:

```
Update::download() → Vec<u8>
      ↓
verify_artifact(bytes, version, keyring_path)   // signed manifest, keyring, anti-rollback
      ↓  (refusal here MUST stop — the running build stays untouched)
install:
  ├─ installed build  → Update::install(&bytes)
  └─ portable build   → write <exe>.new, detached swap after this process exits
```

`Update::install` consumes the `Update` handle, so the handle must be retained between download and
install — `download()` must not drop it.

### C2. The shipped keyring

`resources/release-keyring.json` is a **release artefact**, not test data:

```json
{ "version": 1, "defaultKeyId": "<id>", "keys": { "<id>": { "keyId": "<id>", "publicKeyPem": "…", "revoked": false } } }
```

It is bundled via `bundle.resources` and resolved next to the exe at
`resources/release-keyring.json`. Without it `resolve_keyring_path` returns nothing and
`verify_artifact` refuses **every** update — a silent permanent "no updates available". An empty
keyring is a refusal, never a pass. A Rust test asserts the file ships and loads, so the defect
cannot return unnoticed.

---

## D. Injected bridge contract (`src-tauri/src/bridge.js`)

Injected as an initialization script (`include_str!`) so the renderer is **not modified** (R13i).
Defines `window.antidetect` with exactly the shape `electron/preload.ts` exposed:

```js
window.antidetect = {
  getApiKey(): Promise<string>,                       // invoke('get_api_key')
  onUpdateStatus(cb): () => void,                     // ROOT-level alias; App.tsx:168 calls this
  openExternal(url): void,                            // ROOT-level; App.tsx:179-182 falls back to window.open
  data: {
    getDir():      Promise<string>,                   // GET  /api/v1/data/dir
    setDir():      Promise<{ok:boolean; dir:string}>, // open dialog -> POST /api/v1/data/dir
    prepareDir():  Promise<{ok:boolean; dir:string}>, // open dialog only
    migrateDir(target, migrateData): Promise<{ok:boolean; dir:string; migrated?:boolean; error?:string}>,
    setDirPath(dir): Promise<{ok:boolean; dir:string}>,
    openDir():     Promise<string>,                   // invoke('open_path')
  },
  logs:   { openDir(): Promise<string> },             // invoke('open_path')
  update: {
    check(): Promise<void>,                           // invoke('update_check')
    download(): Promise<void>,                        // invoke('update_download')
    quitAndInstall(): Promise<void>,                  // invoke('update_install')
    onStatus(cb): () => void,                         // listen('update:status')
  },
  window: {
    minimize(): void,                                 // core window API
    toggleMaximize(): void,
    close(): void,
  },
};
```

Every name above has a verified call site; the list is exhaustive, not illustrative:

| Member | Call site |
|---|---|
| `window.{minimize,toggleMaximize,close}` | `App.tsx:439,450,461`; existence gates the buttons at `App.tsx:151` |
| `onUpdateStatus` (root) | `App.tsx:168` |
| `openExternal` (root) | `App.tsx:179-182` |
| `getApiKey` | `api.ts:148,154`; `Settings.tsx:203` |
| `data.{getDir,prepareDir,migrateDir,openDir,setDirPath}` | `Settings.tsx:206,234,244,262,515` |
| `data` / `update` existence | `Settings.tsx:230-231` |
| `logs.openDir` | `Settings.tsx:266` |
| `update.{onStatus,check,download,quitAndInstall}` | `Settings.tsx:223,275,281,285` |

Rules the bridge MUST honour:

- `window.antidetect` is defined **before** page scripts run and MUST NOT overwrite an existing one.
- HTTP calls read the token from `localStorage.apiKey` (where the renderer already stores it) and
  send `Authorization: Bearer …`. Base URL is the page origin.
- `data.getDir()` when no token is stored yet MUST resolve from `localStorage.apiKey` on a later
  call rather than throwing.
- Every method is `try/catch`-guarded: a browser client with no bridge, and a shell where a command
  is unavailable, must both degrade quietly — exactly as `App.tsx`'s `hasNativeWindow` guard expects.
- `data.setDir()`/`prepareDir()` obtain the folder from a shell command that opens the native
  chooser, then (for `setDir`) persist through the backend.

---

## E. Capability contract (`src-tauri/capabilities/`)

Remote-origin IPC is **denied by default** in Tauri v2 and fails silently. Required:

```json
{
  "identifier": "remote-ui",
  "windows": ["main"],
  "remote": { "urls": ["http://127.0.0.1:50325/*", "http://localhost:50325/*"] },
  "permissions": [
    "core:default",
    "core:window:allow-minimize", "core:window:allow-toggle-maximize", "core:window:allow-close",
    "core:event:default", "core:tray:default"
  ]
}
```

`core:default` pulls in `core:window:default`, which — verified in
`src-tauri/gen/schemas/acl-manifests.json` — resolves to allow-get-all-windows, allow-scale-factor,
…, allow-internal-toggle-maximize. It does **not** contain `allow-minimize`,
`allow-toggle-maximize` or `allow-close`; without those three the window buttons are silently inert.

`withGlobalTauri: true` is required so `window.__TAURI__` exists for the injected script.

**Remote + app commands.** A capability with `remote.urls` governs which origins may use IPC at all.
App-defined commands registered by this crate may additionally need an ACL entry (researcher
confirming); if required, the grant is `<crate>:allow-<command>` and goes in the same `permissions`
list. The `tests/unit` bridge test catches the failure either way, because a denied command fails
silently.

---

## F. Ownership zones (Wave 3)

| Zone | Owns (exclusive) | Must not touch |
|---|---|---|
| **B** backend | `src/main/config.ts`, `src/main/security/screenProtection.ts`, `src/main/util/secretStore.ts`, `src/main/api/routes/dataDir.ts`, `src/main/api/routes/shutdown.ts`, `src/main/api/server.ts` | `src-tauri/**`, `src/renderer/**` |
| **S1** core | `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/sidecar.rs`, `src-tauri/capabilities/**` | every other `src-tauri/src/*.rs`, `src/main/**` |
| **S2** native | `src-tauri/src/screen.rs`, `src-tauri/src/secrets.rs`, `src-tauri/src/tray.rs` | `main.rs`, `updater.rs`, `bridge.js` |
| **S3** updates | `src-tauri/src/updater.rs` | `main.rs`, `screen.rs`, `secrets.rs`, `tray.rs`, `bridge.js` |
| **S4** bridge | `src-tauri/src/bridge.js` | every `.rs` |
| **P** packaging | `package.json`, `.github/workflows/ci.yml`, `scripts/vendor-node.mjs` | `src-tauri/**`, `src/main/**`, `tests/**` |
| **X** tests | `tests/unit/tauri*/**`, `tests/unit/desktop*/**`, `tests/unit/bridge*/**` | production sources |

`src/renderer/**` is owned by **nobody** — it must not change (R13i). `openspec/**` is mine alone.

`src/main/index.ts` readiness note: the readiness line already exists in `server.ts`; zone B MUST NOT
invent a second one.
