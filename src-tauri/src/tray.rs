//! System tray integration for NullTrace.
//!
//! Exposes `init` per interfaces.md §C.
//! Left-click toggles window visibility; menu provides "Show" and "Quit".

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// Initialize system tray icon with menu (Show, Quit) and left-click visibility toggle.
///
/// Returns `Err` when the icon or menu cannot be created so that caller can handle
/// graceful degradation (e.g. exit on close instead of hiding with no tray icon).
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<TrayIcon<R>, String> {
    let show_i = MenuItem::with_id(app, "show", "Show NullTrace", true, None::<&str>)
        .map_err(|e| format!("Failed to create Show menu item: {e}"))?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit NullTrace", true, None::<&str>)
        .map_err(|e| format!("Failed to create Quit menu item: {e}"))?;

    let menu = Menu::with_items(app, &[&show_i, &quit_i])
        .map_err(|e| format!("Failed to create tray menu: {e}"))?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "Default window icon not found for tray".to_string())?;

    let tray = TrayIconBuilder::<R>::with_id("main-tray")
        .icon(icon)
        .tooltip("NullTrace")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)
        .map_err(|e| format!("Failed to build tray icon: {e}"))?;

    Ok(tray)
}
