// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use sidecar::{ReadinessStatus, SidecarConfig, SidecarProcess};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct AppState {
    sidecar: Mutex<Option<SidecarProcess>>,
}

fn main() {
    let port = std::env::var("API_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(50325);

    let data_dir = std::env::var("ANTIDETECT_DATA_DIR").ok();

    let sidecar_config = SidecarConfig {
        port,
        data_dir,
        binary_path: "node".to_string(),
        args: vec!["dist/electron/main.js".to_string()],
        ..Default::default()
    };

    let mut sidecar = match SidecarProcess::spawn(sidecar_config) {
        Ok(proc) => proc,
        Err(e) => {
            eprintln!("Failed to spawn backend process: {}", e);
            // Even if spawn fails, Tauri app can open and show error
            run_tauri_app(None, port, Some(format!("Spawn failed: {}", e)));
            return;
        }
    };

    let readiness = sidecar.wait_for_readiness();
    let error_msg = match readiness {
        ReadinessStatus::ReadySignalObserved | ReadinessStatus::PortBoundObserved => None,
        ReadinessStatus::ProcessExitedEarly(code) => {
            Some(format!("Backend process exited early with code {:?}", code))
        }
        ReadinessStatus::TimedOut => {
            Some("Backend startup timed out after 30 seconds".to_string())
        }
    };

    run_tauri_app(Some(sidecar), port, error_msg);
}

fn run_tauri_app(sidecar: Option<SidecarProcess>, port: u16, error_msg: Option<String>) {
    let state = AppState {
        sidecar: Mutex::new(sidecar),
    };

    let app = tauri::Builder::default()
        .manage(state)
        .setup(move |app| {
            let window = app.get_webview_window("main");
            if let Some(w) = window {
                if let Some(err) = error_msg {
                    let html = SidecarProcess::failure_html(&err);
                    let _ = w.navigate(tauri::Url::parse(&format!(
                        "data:text/html;charset=utf-8,{}",
                        urlencoding::encode(&html)
                    )).unwrap_or_else(|_| tauri::Url::parse("about:blank").unwrap()));
                } else {
                    let target_url = format!("http://127.0.0.1:{}", port);
                    if let Ok(url) = tauri::Url::parse(&target_url) {
                        let _ = w.navigate(url);
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            let state = app_handle.state::<AppState>();
            let mut maybe_proc = None;
            if let Ok(mut lock) = state.sidecar.lock() {
                maybe_proc = lock.take();
            }
            if let Some(mut proc) = maybe_proc {
                proc.terminate();
            }
        }
    });
}
