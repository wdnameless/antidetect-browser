// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
        return saved;
    }
    if let Ok(portable_dir) = std::env::var("PORTABLE_EXECUTABLE_DIR") {
        if !portable_dir.trim().is_empty() {
            return PathBuf::from(portable_dir.trim()).join("data");
        }
    }
    settings_dir.join("data")
}

/// Reads `dataDir` from `settings.json`, if present and non-empty.
///
/// Deliberately tolerant: a missing, unreadable or malformed settings file means "no choice
/// recorded", which falls through to the default rather than aborting startup. The prompt
/// re-asks in that case, so a bad file costs one question, not a broken install.
fn saved_data_dir(settings_dir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(settings_dir.join("settings.json")).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let dir = parsed.get("dataDir")?.as_str()?.trim().to_string();
    if dir.is_empty() {
        None
    } else {
        Some(PathBuf::from(dir))
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
fn perform_graceful_teardown(
    sidecar: &sidecar::SidecarManager,
    data_dir: &Path,
    settings_dir: &Path,
    port: u16,
) {
    // Mirrors `get_api_key`'s resolution: data dir first, settings dir as the legacy fallback.
    let api_key = read_key_file(&data_dir.join("api_key"))
        .or_else(|| read_key_file(&settings_dir.join("api_key")));

    sidecar.terminate_graceful(port, api_key.as_deref());
}

/// Reads a key file, trimming whitespace; `None` when absent or unreadable.
fn read_key_file(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

fn main() {
    let settings_dir = sidecar::default_settings_dir();
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
                readiness_timeout: Duration::from_secs(30),
                readiness_signal: sidecar::ReadinessSignal::RealString(
                    "[antidetect] Local API listening on".to_string(),
                ),
            };

            let sidecar_result = setup_sidecar.start(sidecar_config);

            let _ = tray::init(&handle);
            let _ = screen::init(&handle, screen::ScreenSecurityState::default());
            let _ = updater::init(&handle);

            let bridge_script = include_str!("bridge.js");

            let window = WebviewWindowBuilder::new(
                &handle,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("NullTrace")
            .inner_size(1280.0, 800.0)
            .decorations(false)
            .initialization_script(bridge_script)
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

#[cfg(test)]
mod data_dir_tests {
    use super::{resolve_data_dir, saved_data_dir};
    use std::fs;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nulltrace-dd-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The operator's first-run choice MUST win over the default.
    ///
    /// This is the bug that shipped: the shell resolved the DEFAULT path, exported it as
    /// ANTIDETECT_DATA_DIR, and the backend (which prefers the env var) wrote there — the
    /// chosen folder stayed empty while profiles piled up in the profile directory.
    #[test]
    fn honours_the_directory_recorded_in_settings() {
        let settings = tmp("honours");
        let chosen = settings.join("my-profiles");
        fs::write(
            settings.join("settings.json"),
            format!(r#"{{"dataDir":{:?}}}"#, chosen.to_string_lossy()),
        )
        .unwrap();

        // No env override: the recorded choice is the only signal.
        std::env::remove_var("ANTIDETECT_DATA_DIR");
        std::env::remove_var("PORTABLE_EXECUTABLE_DIR");

        assert_eq!(resolve_data_dir(&settings), chosen);
    }

    /// Portable mode must still resolve beside the executable when nothing was recorded.
    #[test]
    fn falls_back_to_portable_beside_the_executable() {
        let settings = tmp("portable");
        std::env::remove_var("ANTIDETECT_DATA_DIR");
        std::env::set_var("PORTABLE_EXECUTABLE_DIR", settings.join("app"));
        let resolved = resolve_data_dir(&settings);
        std::env::remove_var("PORTABLE_EXECUTABLE_DIR");
        assert_eq!(resolved, settings.join("app").join("data"));
    }

    /// A missing, unreadable or malformed settings file means "no choice recorded".
    /// Returning None keeps startup alive and lets the prompt re-ask, rather than aborting.
    #[test]
    fn unreadable_or_absent_settings_means_no_choice() {
        let settings = tmp("absent");
        assert!(saved_data_dir(&settings).is_none());

        fs::write(settings.join("settings.json"), b"{ this is not json").unwrap();
        assert!(saved_data_dir(&settings).is_none());

        fs::write(settings.join("settings.json"), br#"{"dataDir":"   "}"#).unwrap();
        assert!(saved_data_dir(&settings).is_none());
    }

    /// An empty dataDir must not be treated as a recorded choice.
    #[test]
    fn empty_recorded_dir_is_not_a_choice() {
        let settings = tmp("empty");
        fs::write(settings.join("settings.json"), br#"{"dataDir":""}"#).unwrap();
        assert!(saved_data_dir(&settings).is_none());
    }
}

#[cfg(test)]
mod teardown_key_tests {
    use super::read_key_file;
    use std::fs;
    use std::path::PathBuf;

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
}
