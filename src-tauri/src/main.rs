// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

mod screen;
mod secrets;
mod sidecar;
mod tray;
mod updater;

use sidecar::SidecarManager;

#[derive(serde::Serialize)]
pub struct CommandResult {
    ok: bool,
    error: Option<String>,
}

#[derive(serde::Serialize)]
pub struct PickResult {
    ok: bool,
    path: Option<String>,
}

pub struct AppState {
    /// Port the backend was instructed to bind. Kept in state so the bridge can build
    /// the API base URL without re-reading the environment.
    pub api_port: u16,
    pub settings_dir: PathBuf,
    pub data_dir: PathBuf,
    pub sidecar: Arc<SidecarManager>,
}
/// Returns the default directory where settings (and settings.json) live.
///
/// 1. ANTIDETECT_SETTINGS_DIR if set and non-empty.
/// 2. In portable mode (PORTABLE_EXECUTABLE_DIR is set and non-empty): the portable folder itself.
/// 3. Otherwise: delegates to sidecar::default_settings_dir() (%APPDATA%/antidetect-browser on Windows).
pub fn default_settings_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ANTIDETECT_SETTINGS_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir.trim());
        }
    }
    if let Ok(dir) = std::env::var("PORTABLE_EXECUTABLE_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir.trim());
        }
    }
    sidecar::default_settings_dir()
}

/// Resolves the data directory the backend uses.
/// Matches backend config.ts resolveDataDir:
/// 1. ANTIDETECT_DATA_DIR env var if set.
/// 2. A directory recorded in settings.json (the operator's first-run choice).
/// 3. If PORTABLE_EXECUTABLE_DIR is set, PORTABLE_EXECUTABLE_DIR/data.
/// 4. Otherwise settings_dir/data.
///
/// Step 2 is not optional: the first-run prompt persists the choice to `settings.json`, and
/// without reading it here the shell would resolve the DEFAULT path, export it as
/// `ANTIDETECT_DATA_DIR`, and the backend — which honours the env var above all — would write
/// to the default location no matter what the operator picked. The chosen folder would sit
/// empty while profiles piled up in the profile directory.
pub fn resolve_data_dir(settings_dir: &Path) -> PathBuf {
    if let Ok(dir) = std::env::var("ANTIDETECT_DATA_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir.trim());
        }
    }
    if let Some(saved) = saved_data_dir(settings_dir) {
        // Mirror `config.ts` exactly: a recorded path is honoured only while it is usable on
        // THIS machine. The shell exports its answer as ANTIDETECT_DATA_DIR, which the backend
        // treats as authoritative — so a check that lived only in the backend would be
        // bypassed here. That is the USB case: the folder carries `settings.json` with the
        // path recorded on the machine it was prepared on, and on another machine that path
        // usually does not exist. Honouring it blindly pointed the whole app at a directory
        // that is not there, while the folder the operator actually opened stayed unused.
        if data_dir_holds_data(&saved) {
            mark_data_root(&saved);
            return saved;
        }
    }
    if let Ok(portable_dir) = std::env::var("PORTABLE_EXECUTABLE_DIR") {
        if !portable_dir.trim().is_empty() {
            let portable_data = PathBuf::from(portable_dir.trim()).join("data");
            mark_data_root(&portable_data);
            return portable_data;
        }
    }
    let fallback = settings_dir.join("data");
    mark_data_root(&fallback);
    fallback
}

/// The settings file an installation used BEFORE settings moved beside the executable.
///
/// Mirrors `config.ts:legacySettingsFile`. Reading only the portable location made the record
/// of an existing installation's data folder invisible: the backend then created a SECOND data
/// directory beside the app. This shell resolves the path independently and exports it, so it
/// needs the same fallback — otherwise the shell and the backend would disagree.
fn legacy_settings_file(settings_dir: &Path) -> Option<PathBuf> {
    // A pinned settings directory means "read settings HERE"; looking elsewhere would override
    // that with a stale file from the user profile.
    if let Ok(dir) = std::env::var("ANTIDETECT_SETTINGS_DIR") {
        if !dir.trim().is_empty() {
            return None;
        }
    }
    if std::env::var("PORTABLE_EXECUTABLE_DIR").map(|d| d.trim().is_empty()).unwrap_or(true) {
        return None;
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(PathBuf::from(appdata).join("antidetect-browser").join("settings.json"));
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        candidates.push(PathBuf::from(home).join(".antidetect").join("settings.json"));
    }
    candidates.into_iter().find(|p| p.exists())
}

/// Reads `dataDir` from `settings.json`, if present and non-empty.
///
/// Deliberately tolerant: a missing, unreadable or malformed settings file means "no choice
/// recorded", which falls through to the default rather than aborting startup. The prompt
/// re-asks in that case, so a bad file costs one question, not a broken install.
fn saved_data_dir(settings_dir: &Path) -> Option<PathBuf> {
    if let Some(dir) = read_data_dir_from(&settings_dir.join("settings.json")) {
        return Some(dir);
    }
    // Fall back to the pre-move location and MIGRATE it: once the portable copy exists the
    // legacy one is never read again, which is what keeps a copied folder self-contained.
    let legacy = legacy_settings_file(settings_dir)?;
    let dir = read_data_dir_from(&legacy)?;
    if let Some(text) = fs::read_to_string(&legacy).ok() {
        let _ = fs::create_dir_all(settings_dir);
        let _ = fs::write(settings_dir.join("settings.json"), text);
    }
    Some(dir)
}

/// `dataDir` from one settings file, or None when it is absent, unreadable, empty or malformed.
fn read_data_dir_from(file: &Path) -> Option<PathBuf> {
    let raw = fs::read_to_string(file).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let dir = parsed.get("dataDir")?.as_str()?.trim().to_string();
    if dir.is_empty() {
        None
    } else {
        Some(PathBuf::from(dir))
    }
}

/// Claim a directory as this installation's data root.
///
/// Mirrors `config.ts:markDataRoot`. The marker is what lets a folder the operator has just
/// chosen — empty, with no database and no profiles yet — still count as "ours" on the next
/// launch, while a stranger's directory that merely exists does not.
fn mark_data_root(dir: &Path) {
    let _ = fs::create_dir_all(dir);
    let _ = fs::write(dir.join(".nulltrace-data-root"), "nulltrace\n");
}

/// Whether `dir` holds data this installation can use — the mirror of `config.ts:dataDirHoldsData`.
///
/// The signals must be ones only real use produces: `config.ts` eagerly creates the data dir,
/// `profiles/`, `chromium/` and an empty database, so their mere existence proves nothing.
fn data_dir_holds_data(dir: &Path) -> bool {
    if !dir.exists() {
        return false;
    }
    if dir.join("antidetect.db").exists() || dir.join(".nulltrace-data-root").exists() {
        return true;
    }
    match fs::read_dir(dir.join("profiles")) {
        Ok(mut entries) => entries.next().is_some(),
        Err(_) => false,
    }
}

/// Reads a key file, trimming whitespace; `None` when absent or unreadable.
fn read_key_file(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

/// The root of a movable folder, for a macOS application bundle.
///
/// macOS cannot ship a single-file executable: the artefact is a `.app` directory, and the binary
/// inside it lives at `<root>/<Name>.app/Contents/MacOS/<Name>`. The portable root is therefore
/// three ancestors up — the directory the operator actually copies. Returning `None` for anything
/// that is not that exact shape keeps a non-portable launch (an app in `/Applications`, a dev run
/// from `target/debug`) on the normal, non-portable path.
///
/// Derived from the running executable rather than from an environment variable because nothing
/// sets one on macOS: on Windows the NSIS launcher exports `PORTABLE_EXECUTABLE_DIR`, and there is
/// no equivalent launcher here.
fn portable_root_from_bundle(exe: &Path) -> Option<PathBuf> {
    let macos_dir = exe.parent()?;
    let contents = macos_dir.parent()?;
    let app_bundle = contents.parent()?;

    let is_bundle_layout = macos_dir.file_name()?.to_str() == Some("MacOS")
        && contents.file_name()?.to_str() == Some("Contents")
        && app_bundle.extension()?.to_str() == Some("app");
    if !is_bundle_layout {
        return None;
    }
    app_bundle.parent().map(|p| p.to_path_buf())
}

/// Export the portable root so the backend, the webview cache and the data directory agree.
///
/// Mirrors what `src-tauri/windows/portable.nsi` does with `SetEnvironmentVariable` on Windows:
/// ONE producer sets the variable and every consumer reads it, so the two platforms cannot drift
/// into two conventions. An already-set value wins — an operator or a test that pinned a location
/// must not be overridden by a guess derived from the bundle's position.
pub fn export_portable_root_if_bundled(exe: &Path) {
    if std::env::var("PORTABLE_EXECUTABLE_DIR").map(|d| !d.trim().is_empty()).unwrap_or(false) {
        return;
    }
    if let Some(root) = portable_root_from_bundle(exe) {
        std::env::set_var("PORTABLE_EXECUTABLE_DIR", &root);
    }
}

#[tauri::command]
async fn get_api_key(state: State<'_, AppState>) -> Result<Option<String>, String> {
    // The backend writes api_key to DATA_DIR/api_key (src/main/config.ts getApiKey()).
    // In portable mode or custom data dir, DATA_DIR differs from settings_dir.
    // Check resolved data_dir first, then fall back to settings_dir.
    let key_file = state.data_dir.join("api_key");
    if key_file.exists() {
        let content = std::fs::read_to_string(&key_file).map_err(|e| e.to_string())?;
        let key = content.trim().to_string();
        if !key.is_empty() {
            return Ok(Some(key));
        }
    }

    let fallback_file = state.settings_dir.join("api_key");
    if fallback_file.exists() {
        let content = std::fs::read_to_string(&fallback_file).map_err(|e| e.to_string())?;
        let key = content.trim().to_string();
        if !key.is_empty() {
            return Ok(Some(key));
        }
    }
    Ok(None)
}

#[tauri::command]
async fn set_api_key(key: String, state: State<'_, AppState>) -> Result<(), String> {
    let key_file = state.data_dir.join("api_key");
    if let Some(parent) = key_file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&key_file, key.trim()).map_err(|e| e.to_string())?;
    // Also write to settings_dir for backwards compatibility
    let fallback = state.settings_dir.join("api_key");
    let _ = std::fs::write(&fallback, key.trim());
    Ok(())
}

#[tauri::command]
async fn open_path(app: AppHandle, path: String) -> Result<CommandResult, String> {
    use tauri_plugin_opener::OpenerExt;
    match app.opener().open_path(&path, None::<&str>) {
        Ok(_) => Ok(CommandResult { ok: true, error: None }),
        Err(e) => Ok(CommandResult { ok: false, error: Some(e.to_string()) }),
    }
}

#[tauri::command]
async fn pick_directory(app: AppHandle) -> Result<PickResult, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_can_create_directories(true)
        .pick_folder(move |folder_path| {
            let _ = tx.send(folder_path);
        });

    match rx.recv() {
        Ok(Some(path)) => Ok(PickResult {
            ok: true,
            path: Some(path.to_string()),
        }),
        Ok(None) => Ok(PickResult { ok: false, path: None }),
        Err(e) => Err(format!("Dialog channel error: {e}")),
    }
}

/// Restart the shell, so a change that only takes effect on the next start can apply.
///
/// Used by the first-run data-folder prompt: `DATA_DIR` is resolved once when the backend
/// starts, and moving a live SQLite database underneath a running service is not something to
/// do silently. The operator chose a location, the choice is persisted, and this restarts so
/// it takes effect.
///
/// `AppHandle::restart` triggers `RunEvent::ExitRequested` and `RunEvent::Exit`, which is
/// exactly the path that already runs `perform_graceful_teardown` — the backend is asked to
/// stop (`POST /api/v1/shutdown`), then force-killed only if it does not, so the database is
/// flushed and the port released instead of being orphaned by an abrupt exit.
#[tauri::command]
async fn restart_app(app: AppHandle) {
    app.restart()
}

fn resolve_node_path(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        #[cfg(target_os = "windows")]
        {
            candidates.push(resource_dir.join("binaries").join("node-x86_64-pc-windows-msvc.exe"));
            candidates.push(resource_dir.join("node.exe"));
        }
        #[cfg(target_os = "macos")]
        {
            candidates.push(resource_dir.join("binaries").join("node-x86_64-apple-darwin"));
            candidates.push(resource_dir.join("node"));
        }
        #[cfg(target_os = "linux")]
        {
            candidates.push(resource_dir.join("binaries").join("node-x86_64-unknown-linux-gnu"));
            candidates.push(resource_dir.join("node"));
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            #[cfg(target_os = "windows")]
            {
                candidates.push(exe_dir.join("node.exe"));
                candidates.push(exe_dir.join("binaries").join("node-x86_64-pc-windows-msvc.exe"));
            }
            #[cfg(not(target_os = "windows"))]
            {
                candidates.push(exe_dir.join("node"));
                candidates.push(exe_dir.join("binaries").join("node"));
            }
        }
    }

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    #[cfg(debug_assertions)]
    {
        if let Ok(out) = std::process::Command::new("node").arg("--version").output() {
            if out.status.success() {
                return Some(PathBuf::from("node"));
            }
        }
    }

    None
}

fn failure_html(error_message: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>NullTrace - Startup Error</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }}
    .card {{
      background: #1e293b;
      padding: 2rem;
      border-radius: 0.75rem;
      max-width: 500px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
      border: 1px solid #334155;
    }}
    h1 {{ color: #ef4444; margin-top: 0; font-size: 1.25rem; }}
    pre {{ background: #090d16; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.85rem; color: #cbd5e1; }}
  </style>
</head>
<body>
  <div class="card">
    <h1>NullTrace Failed to Start</h1>
    <p>The local background service failed to initialize:</p>
    <pre>{}</pre>
  </div>
</body>
</html>"#,
        html_escape(error_message)
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Stops the backend on the way out.
///
/// The API key must be read from the DATA directory first, because that is where the backend
/// writes it (`config.ts:getApiKey` → `DATA_DIR/api_key`). Reading only `settings_dir/api_key`
/// — as this did — finds nothing whenever the operator has chosen a data folder, so the
/// shutdown request went out unauthenticated, the backend answered 401, stayed alive, and
/// left its instance lock behind for the next launch to misread as a crash.
///
/// The wait is what makes quitting close the open profiles. The backend's shutdown path stops
/// every browser before it exits, and each stop can take seconds; when this waited only five
/// seconds the backend was killed mid-stop and the profiles it had not reached yet stayed
/// running. The bound is therefore generous enough for the backend to finish its own work, and
/// it is still a bound: past it the tree is force-killed, so the app cannot hang on quit.
pub(crate) fn perform_graceful_teardown(
    sidecar: &sidecar::SidecarManager,
    data_dir: &Path,
    settings_dir: &Path,
    port: u16,
) {
    // Mirrors `get_api_key`'s resolution: data dir first, settings dir as the legacy fallback.
    let api_key = read_key_file(&data_dir.join("api_key"))
        .or_else(|| read_key_file(&settings_dir.join("api_key")));

    sidecar.terminate_graceful(port, api_key.as_deref(), TEARDOWN_WAIT);
}

/// How long the shell waits for the backend to stop its profiles and exit.
///
/// Sized for the backend's worst case: it stops profiles concurrently, each waiting up to five
/// seconds for its browser plus a little for the force-kill fallback, and then closes the
/// database. Twenty seconds leaves room for that and for a slow disk, while still ending — a
/// quit that hangs forever is a worse failure than a quit that takes a moment.
const TEARDOWN_WAIT: Duration = Duration::from_secs(20);

fn main() {
    // Before anything reads a path: on macOS the portable root is derived from where this
    // executable sits, and every consumer below (settings dir, data dir, webview cache) keys off
    // `PORTABLE_EXECUTABLE_DIR`. Without this the app would resolve to the system locations and
    // the moved-folder behaviour the operator asked for would not exist on this platform.
    if let Ok(exe) = std::env::current_exe() {
        export_portable_root_if_bundled(&exe);
    }

    let settings_dir = default_settings_dir();
    // Did the location arrive from OUTSIDE (operator, CI, a script) rather than from us?
    // The backend asks the operator where data should live on first run, but must not ask
    // when the path is imposed. It cannot tell the difference by looking at the variable
    // alone, because we export our own resolved path below — so record the origin here.
    let externally_pinned = std::env::var("ANTIDETECT_DATA_DIR")
        .map(|d| !d.trim().is_empty())
        .unwrap_or(false);
    let data_dir = resolve_data_dir(&settings_dir);
    // Ensure the sidecar sees the resolved ANTIDETECT_DATA_DIR so both shell and sidecar match
    std::env::set_var("ANTIDETECT_DATA_DIR", &data_dir);
    if !externally_pinned {
        // Our own export: the value is bookkeeping, not an instruction to skip the prompt.
        std::env::set_var("ANTIDETECT_DATA_DIR_FROM_SHELL", "1");
    }

    // Honour the operator's API_PORT. Previously this was a bare `50325` literal while the
    // sidecar was told the literal too, so an override was silently ignored: the backend
    // stayed on its own default and nothing surfaced the mismatch.
    let api_port: u16 = std::env::var("API_PORT")
        .ok()
        .and_then(|p| p.trim().parse().ok())
        .unwrap_or(50325);
    let sidecar_manager = Arc::new(sidecar::SidecarManager::new());

    let state_settings_dir = settings_dir.clone();
    let state_data_dir = data_dir.clone();
    let state_sidecar = Arc::clone(&sidecar_manager);

    let setup_sidecar = Arc::clone(&sidecar_manager);
    let setup_settings_dir = settings_dir.clone();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            settings_dir: state_settings_dir,
            data_dir: state_data_dir,
            api_port,
            sidecar: state_sidecar,
        })
        .invoke_handler(tauri::generate_handler![
            get_api_key,
            set_api_key,
            open_path,
            pick_directory,
            restart_app,
            secrets::secret_encrypt,
            secrets::secret_decrypt,
            updater::update_check,
            updater::update_download,
            updater::update_install,
        ]);

    let app = builder
        .setup(move |app| {
            let handle = app.handle().clone();
            let node_path = resolve_node_path(&handle);

            let resources_dir = handle.path().resource_dir().ok();
            let mut script_candidates = Vec::new();
            if let Some(ref res) = resources_dir {
                script_candidates.push(res.join("dist").join("src").join("main").join("index.js"));
                script_candidates.push(res.join("_up_").join("dist").join("src").join("main").join("index.js"));
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    script_candidates.push(dir.join("dist").join("src").join("main").join("index.js"));
                    script_candidates.push(dir.join("..").join("dist").join("src").join("main").join("index.js"));
                    script_candidates.push(dir.join("..").join("..").join("dist").join("src").join("main").join("index.js"));
                    script_candidates.push(dir.join("..").join("..").join("..").join("dist").join("src").join("main").join("index.js"));
                }
            }
            script_candidates.push(PathBuf::from("dist").join("src").join("main").join("index.js"));
            let resolved_script = script_candidates
                .into_iter()
                .find(|p| p.exists())
                .map(|p| p.canonicalize().unwrap_or(p))
                .unwrap_or_else(|| PathBuf::from("dist").join("src").join("main").join("index.js"));
            let resolved_script = {
                let s = resolved_script.to_string_lossy();
                if let Some(stripped) = s.strip_prefix(r"\\?\") {
                    PathBuf::from(stripped)
                } else {
                    resolved_script
                }
            };

            let sidecar_config = sidecar::SidecarConfig {
                port: api_port,
                settings_dir: setup_settings_dir.clone(),
                resources_dir,
                node_path,
                script_path: Some(resolved_script),
                args: vec![],
                env: vec![],
                // The version Tauri baked in from tauri.conf.json. The installed artefact
                // does not ship package.json, so this is the only value that is right on a
                // user's machine.
                app_version: Some(app.package_info().version.to_string()),
                readiness_timeout: Duration::from_secs(30),
                readiness_line: "[antidetect] Local API listening on".to_string(),
            };

            let sidecar_result = setup_sidecar.start(sidecar_config);

            let _ = tray::init(&handle);
            let _ = screen::init(&handle, screen::ScreenSecurityState::default());
            let _ = updater::init(&handle);

            let bridge_script = include_str!("bridge.js");

            let mut builder = WebviewWindowBuilder::new(
                &handle,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("NullTrace")
            .inner_size(1280.0, 800.0)
            .decorations(false)
            .initialization_script(bridge_script);

            if let Ok(portable_dir) = std::env::var("PORTABLE_EXECUTABLE_DIR") {
                if !portable_dir.trim().is_empty() {
                    let webview_dir = PathBuf::from(portable_dir.trim()).join("webview");
                    builder = builder.data_directory(webview_dir);
                }
            }

            let window = builder
                .build()
                .expect("failed to create main window");

            match sidecar_result {
                Ok(_) => {
                    let target_url: url::Url = format!("http://127.0.0.1:{api_port}").parse().unwrap();
                    let _ = window.navigate(target_url);
                }
                Err(err) => {
                    eprintln!("[shell] Sidecar failed to start: {err}");

                    handle
                        .dialog()
                        .message(format!(
                            "NullTrace backend failed to start:\n\n{err}\n\nPlease verify application installation."
                        ))
                        .title("NullTrace - Startup Error")
                        .blocking_show();

                    let html = failure_html(&err);
                    let data_url: url::Url = format!("data:text/html;charset=utf-8,{}", urlencoding::encode(&html))
                        .parse()
                        .unwrap();
                    let _ = window.navigate(data_url);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let teardown_sidecar = Arc::clone(&sidecar_manager);
    let teardown_settings_dir = settings_dir.clone();
    let teardown_data_dir = data_dir.clone();

    app.run(move |_app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            perform_graceful_teardown(&teardown_sidecar, &teardown_data_dir, &teardown_settings_dir, api_port);
        }
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { .. },
            ..
        } => {
            if label == "main" {
                perform_graceful_teardown(&teardown_sidecar, &teardown_data_dir, &teardown_settings_dir, api_port);
            }
        }
        _ => {}
    });
}

/// The ONE lock guarding process-wide environment mutation in tests.
///
/// `std::env::set_var` is process-global, so two test modules that each declare their own mutex
/// still race: `data_dir_tests` removing `PORTABLE_EXECUTABLE_DIR` while
/// `updater::tests::test_update_channel_target_reflects_portable_mode` sets it. Measured — the
/// suite passed or failed on which order the threads happened to interleave, roughly one run in
/// three failing. Every test that touches these variables must take this lock, not its own.
#[cfg(test)]
pub(crate) fn test_env_lock() -> parking_lot::MutexGuard<'static, ()> {
    static LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
    LOCK.lock()
}

#[cfg(test)]
mod data_dir_tests {
    use super::{default_settings_dir, resolve_data_dir, saved_data_dir};
    use std::fs;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nulltrace-dd-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    /// Point the pre-move settings location at an empty directory.
    ///
    /// `saved_data_dir` falls back to `%APPDATA%\antidetect-browser\settings.json` so a
    /// migrated installation keeps the data folder it recorded there. Without isolating that,
    /// these assertions would depend on whatever this machine happens to hold — which is
    /// exactly how they failed when the fallback was added.
    fn isolate_legacy(settings: &std::path::Path) {
        let empty = settings.join("empty-appdata");
        let _ = fs::create_dir_all(&empty);
        std::env::set_var("APPDATA", &empty);
        std::env::set_var("USERPROFILE", &empty);
    }

    /// The operator's first-run choice MUST win over the default.
    ///
    /// This is the bug that shipped: the shell resolved the DEFAULT path, exported it as
    /// ANTIDETECT_DATA_DIR, and the backend (which prefers the env var) wrote there — the
    /// chosen folder stayed empty while profiles piled up in the profile directory.
    #[test]
    fn honours_the_directory_recorded_in_settings() {
        let _lock = super::test_env_lock();
        let orig_data = std::env::var("ANTIDETECT_DATA_DIR").ok();
        let orig_portable = std::env::var("PORTABLE_EXECUTABLE_DIR").ok();

        let settings = tmp("honours");
        let chosen = settings.join("my-profiles");
        // The recorded folder must hold data — or carry the ownership marker — because a
        // recorded path is otherwise indistinguishable from another machine's. Marking it is
        // exactly what choosing it does, so this is the ordinary state of a chosen folder.
        fs::create_dir_all(&chosen).unwrap();
        fs::write(chosen.join(".nulltrace-data-root"), "nulltrace\n").unwrap();
        fs::write(
            settings.join("settings.json"),
            format!(r#"{{"dataDir":{:?}}}"#, chosen.to_string_lossy()),
        )
        .unwrap();
        isolate_legacy(&settings);

        // No env override: the recorded choice is the only signal.
        std::env::remove_var("ANTIDETECT_DATA_DIR");
        std::env::remove_var("PORTABLE_EXECUTABLE_DIR");

        let res = resolve_data_dir(&settings);

        if let Some(v) = orig_data { std::env::set_var("ANTIDETECT_DATA_DIR", v); }
        if let Some(v) = orig_portable { std::env::set_var("PORTABLE_EXECUTABLE_DIR", v); }

        assert_eq!(res, chosen);
    }

    /// The USB case: the folder carries `settings.json` recorded on ANOTHER machine, whose
    /// absolute path does not exist here. Honouring it would point the whole app at a missing
    /// directory while the folder the operator opened stayed unused; the launch must fall
    /// through to portable data beside the executable instead.
    #[test]
    fn ignores_a_recorded_path_that_is_not_usable_here() {
        let _lock = super::test_env_lock();
        let orig_data = std::env::var("ANTIDETECT_DATA_DIR").ok();
        let orig_portable = std::env::var("PORTABLE_EXECUTABLE_DIR").ok();

        let settings = tmp("moved");
        let app_dir = settings.join("app");
        fs::create_dir_all(&app_dir).unwrap();
        isolate_legacy(&settings);

        // Case 1: the recorded path does not exist on this machine at all.
        let absent = settings.join("never-existed-elsewhere");
        fs::write(
            settings.join("settings.json"),
            format!(r#"{{"dataDir":{:?}}}"#, absent.to_string_lossy()),
        )
        .unwrap();
        std::env::remove_var("ANTIDETECT_DATA_DIR");
        std::env::set_var("PORTABLE_EXECUTABLE_DIR", &app_dir);
        assert_eq!(resolve_data_dir(&settings), app_dir.join("data"));

        // Case 2: the path exists but is empty and unmarked — a stranger's directory, or the
        // leftover of a copy that never completed. It must not win either.
        let empty = settings.join("exists-but-empty");
        fs::create_dir_all(&empty).unwrap();
        fs::write(
            settings.join("settings.json"),
            format!(r#"{{"dataDir":{:?}}}"#, empty.to_string_lossy()),
        )
        .unwrap();
        assert_eq!(resolve_data_dir(&settings), app_dir.join("data"));

        if let Some(v) = orig_data { std::env::set_var("ANTIDETECT_DATA_DIR", v); } else { std::env::remove_var("ANTIDETECT_DATA_DIR"); }
        if let Some(v) = orig_portable { std::env::set_var("PORTABLE_EXECUTABLE_DIR", v); } else { std::env::remove_var("PORTABLE_EXECUTABLE_DIR"); }
    }

    /// A recorded path holding real data still wins, marker or not.
    #[test]
    fn honours_a_recorded_path_that_holds_real_data() {
        let _lock = super::test_env_lock();
        let orig_data = std::env::var("ANTIDETECT_DATA_DIR").ok();
        let orig_portable = std::env::var("PORTABLE_EXECUTABLE_DIR").ok();

        let settings = tmp("realdata");
        let real = settings.join("real-data");
        isolate_legacy(&settings);
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("antidetect.db"), b"db").unwrap();
        fs::write(
            settings.join("settings.json"),
            format!(r#"{{"dataDir":{:?}}}"#, real.to_string_lossy()),
        )
        .unwrap();

        std::env::remove_var("ANTIDETECT_DATA_DIR");
        std::env::set_var("PORTABLE_EXECUTABLE_DIR", settings.join("app"));

        let res = resolve_data_dir(&settings);

        if let Some(v) = orig_data { std::env::set_var("ANTIDETECT_DATA_DIR", v); } else { std::env::remove_var("ANTIDETECT_DATA_DIR"); }
        if let Some(v) = orig_portable { std::env::set_var("PORTABLE_EXECUTABLE_DIR", v); } else { std::env::remove_var("PORTABLE_EXECUTABLE_DIR"); }

        assert_eq!(res, real);
    }

    /// Portable mode must still resolve beside the executable when nothing was recorded.
    #[test]
    fn falls_back_to_portable_beside_the_executable() {
        let _lock = super::test_env_lock();
        let orig_data = std::env::var("ANTIDETECT_DATA_DIR").ok();
        let orig_portable = std::env::var("PORTABLE_EXECUTABLE_DIR").ok();

        let settings = tmp("portable");
        isolate_legacy(&settings);
        std::env::remove_var("ANTIDETECT_DATA_DIR");
        std::env::set_var("PORTABLE_EXECUTABLE_DIR", settings.join("app"));
        let resolved = resolve_data_dir(&settings);

        if let Some(v) = orig_data { std::env::set_var("ANTIDETECT_DATA_DIR", v); } else { std::env::remove_var("ANTIDETECT_DATA_DIR"); }
        if let Some(v) = orig_portable { std::env::set_var("PORTABLE_EXECUTABLE_DIR", v); } else { std::env::remove_var("PORTABLE_EXECUTABLE_DIR"); }

        assert_eq!(resolved, settings.join("app").join("data"));
    }

    #[test]
    fn default_settings_dir_resolves_portable_when_env_is_set() {
        let _lock = super::test_env_lock();
        let orig_settings = std::env::var("ANTIDETECT_SETTINGS_DIR").ok();
        let orig_portable = std::env::var("PORTABLE_EXECUTABLE_DIR").ok();

        let fake_portable = tmp("portable_settings");
        std::env::remove_var("ANTIDETECT_SETTINGS_DIR");
        std::env::set_var("PORTABLE_EXECUTABLE_DIR", &fake_portable);

        let dir = default_settings_dir();
        assert_eq!(dir, fake_portable);

        // ANTIDETECT_SETTINGS_DIR takes precedence even in portable mode
        let custom_settings = tmp("custom_settings");
        std::env::set_var("ANTIDETECT_SETTINGS_DIR", &custom_settings);
        let dir_custom = default_settings_dir();
        assert_eq!(dir_custom, custom_settings);

        if let Some(v) = orig_settings { std::env::set_var("ANTIDETECT_SETTINGS_DIR", v); } else { std::env::remove_var("ANTIDETECT_SETTINGS_DIR"); }
        if let Some(v) = orig_portable { std::env::set_var("PORTABLE_EXECUTABLE_DIR", v); } else { std::env::remove_var("PORTABLE_EXECUTABLE_DIR"); }
    }

    /// A missing, unreadable or malformed settings file means "no choice recorded".
    /// Returning None keeps startup alive and lets the prompt re-ask, rather than aborting.
    #[test]
    fn unreadable_or_absent_settings_means_no_choice() {
        let _lock = super::test_env_lock();
        let settings = tmp("absent");
        isolate_legacy(&settings);
        assert!(saved_data_dir(&settings).is_none());

        fs::write(settings.join("settings.json"), b"{ this is not json").unwrap();
        assert!(saved_data_dir(&settings).is_none());

        fs::write(settings.join("settings.json"), br#"{"dataDir":"   "}"#).unwrap();
        assert!(saved_data_dir(&settings).is_none());
    }

    /// An empty dataDir must not be treated as a recorded choice.
    #[test]
    fn empty_recorded_dir_is_not_a_choice() {
        let _lock = super::test_env_lock();
        let settings = tmp("empty");
        // Isolated for the same reason as its siblings: `saved_data_dir` consults the pre-move
        // location, and on a developer's machine that file EXISTS and records a real dataDir.
        // Without this the assertion depends on the host — measured as an intermittent failure.
        isolate_legacy(&settings);
        fs::write(settings.join("settings.json"), br#"{"dataDir":""}"#).unwrap();
        assert!(saved_data_dir(&settings).is_none());
    }
}

#[cfg(test)]
mod bundle_root_tests {
    use super::portable_root_from_bundle;
    use std::path::{Path, PathBuf};

    /// The shape macOS actually ships: the portable root is the directory holding the `.app`.
    #[test]
    fn derives_the_root_from_inside_a_bundle() {
        let exe = Path::new("/Volumes/STICK/NullTrace/NullTrace.app/Contents/MacOS/NullTrace");
        assert_eq!(
            portable_root_from_bundle(exe),
            Some(PathBuf::from("/Volumes/STICK/NullTrace"))
        );
    }

    /// Everything that is NOT that layout must return None, so a dev run from `target/debug`
    /// keeps the ordinary, non-portable path instead of silently claiming that the folder above
    /// it owns its data.
    ///
    /// Note the deliberate inclusion: a bundle in `/Applications` IS bundle-shaped and therefore
    /// resolves — the same rule serves both "an app moved onto a stick" and "an app dragged into
    /// Applications". What must not resolve is everything below.
    #[test]
    fn refuses_anything_that_is_not_a_bundle() {
        assert_eq!(
            portable_root_from_bundle(Path::new("/Applications/NullTrace.app/Contents/MacOS/NullTrace")),
            Some(PathBuf::from("/Applications"))
        );
        // A plain executable in a directory.
        assert_eq!(portable_root_from_bundle(Path::new("/usr/local/bin/node")), None);
        // Inside an app bundle but not at Contents/MacOS (a helper, a framework).
        assert_eq!(
            portable_root_from_bundle(Path::new("/Applications/X.app/Contents/Frameworks/X")),
            None
        );
        // Contents/MacOS but no .app above it.
        assert_eq!(
            portable_root_from_bundle(Path::new("/tmp/Contents/MacOS/thing")),
            None
        );
        // A debug build: the directory above `target/debug` is not a portable root.
        assert_eq!(
            portable_root_from_bundle(Path::new("/repo/src-tauri/target/debug/nulltrace-tauri-shell")),
            None
        );
        // Bare relative path with no ancestors.
        assert_eq!(portable_root_from_bundle(Path::new("NullTrace")), None);
    }

    /// A bundle directly at the filesystem root has no parent to return.
    #[test]
    fn a_bundle_at_the_root_has_no_root_above_it() {
        // "/A.app/Contents/MacOS/A" -> parent of "/A.app" is "/", which is a real directory, so
        // this resolves to "/" rather than None. Asserted explicitly because the alternative
        // (panicking, or returning a bogus path) would be worse than the honest answer.
        let derived = portable_root_from_bundle(Path::new("/A.app/Contents/MacOS/A"));
        assert_eq!(derived, Some(PathBuf::from("/")));
    }
}

#[cfg(test)]
mod teardown_key_tests {
    use super::read_key_file;
    use std::fs;
    use std::path::PathBuf;
    use std::time::Duration;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nulltrace-tk-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_and_trims_a_key_file() {
        let dir = tmp("read");
        fs::write(dir.join("api_key"), "  abc-123\n", ).unwrap();
        assert_eq!(read_key_file(&dir.join("api_key")).as_deref(), Some("abc-123"));
    }

    #[test]
    fn missing_key_file_is_none() {
        let dir = tmp("missing");
        assert!(read_key_file(&dir.join("api_key")).is_none());
    }

    /// The teardown must find the key where the BACKEND writes it.
    ///
    /// This is the defect: teardown read `settings_dir/api_key` while `config.ts:getApiKey`
    /// writes `DATA_DIR/api_key`. With a chosen data folder those differ, so the shutdown
    /// request carried no token, the backend answered 401, kept running, and left its lock
    /// behind — which the next launch then misread as a crash.
    #[test]
    fn resolves_the_key_from_the_data_dir_first() {
        let settings = tmp("settings");
        let data = tmp("data");
        fs::write(settings.join("api_key"), "legacy", ).unwrap();
        fs::write(data.join("api_key"), "current", ).unwrap();

        // Mirrors perform_graceful_teardown's resolution order.
        let resolved = read_key_file(&data.join("api_key"))
            .or_else(|| read_key_file(&settings.join("api_key")));
        assert_eq!(resolved.as_deref(), Some("current"));
    }

    #[test]
    fn falls_back_to_the_settings_dir_when_the_data_dir_has_none() {
        let settings = tmp("settings-only");
        let data = tmp("data-empty");
        fs::write(settings.join("api_key"), "legacy", ).unwrap();

        let resolved = read_key_file(&data.join("api_key"))
            .or_else(|| read_key_file(&settings.join("api_key")));
        assert_eq!(resolved.as_deref(), Some("legacy"));
    }

    /// The shell's wait must outlast the backend's own shutdown work.
    ///
    /// This is the reported defect, expressed as arithmetic. The backend stops profiles
    /// concurrently, and each stop waits up to five seconds for its browser to exit before
    /// force-killing it. A budget at or below that figure kills the backend mid-stop, and the
    /// profiles it had not reached yet are left running — which is exactly what the operator
    /// saw after quitting from the tray.
    #[test]
    fn teardown_wait_outlasts_the_backends_per_profile_stop() {
        // The backend's bound, mirrored from `stopProfile`'s 5s wait plus its force-kill.
        let per_profile_stop = Duration::from_secs(5);

        assert!(
            super::TEARDOWN_WAIT > per_profile_stop,
            "the shell would kill the backend mid-stop: wait={:?}, per-profile stop={:?}",
            super::TEARDOWN_WAIT,
            per_profile_stop
        );
        // Still a bound, not an unbounded wait: a quit that never returns is its own defect.
        assert!(
            super::TEARDOWN_WAIT <= Duration::from_secs(60),
            "an exit path this slow will read as a hang: {:?}",
            super::TEARDOWN_WAIT
        );
    }
}
