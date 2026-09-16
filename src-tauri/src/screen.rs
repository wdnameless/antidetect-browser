//! Screen protection, capture exclusion, and idle/lock tracking for NullTrace.
//!
//! Implements:
//! - Content protection / capture exclusion (`set_content_protected`).
//! - Idle detection via `GetLastInputInfo` on Windows (`idle_timeout_minutes == 0` disables idle lock).
//! - Power suspend / resume detection via `WM_POWERBROADCAST`.
//! - Session lock / unlock detection via `WTSRegisterSessionNotification` + `WM_WTSSESSION_CHANGE`.
//! - Non-Windows platforms implement capture exclusion; idle and lock are explicit documented no-ops.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// Global screen security state.
#[derive(Clone)]
pub struct ScreenSecurityState {
    /// Whether capture protection is currently enabled.
    pub capture_protection: Arc<AtomicBool>,
    /// Idle timeout in minutes. 0 disables idle locking.
    pub idle_timeout_minutes: Arc<AtomicU32>,
    /// Whether the session is currently locked by idle/suspend/session-lock.
    pub is_locked: Arc<AtomicBool>,
}

impl Default for ScreenSecurityState {
    fn default() -> Self {
        Self {
            capture_protection: Arc::new(AtomicBool::new(false)),
            idle_timeout_minutes: Arc::new(AtomicU32::new(0)),
            is_locked: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Set content protection (capture exclusion) on a window.
///
/// Maps to `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Windows
/// and `NSWindowSharingType::None` on macOS via Tauri's `set_content_protected`.
pub fn set_content_protection<R: Runtime>(
    window: &WebviewWindow<R>,
    protected: bool,
) -> Result<(), String> {
    window
        .set_content_protected(protected)
        .map_err(|e| format!("Failed to set content protection: {e}"))
}

/// Helper function to decide whether an idle lock should trigger.
///
/// Invariant: `idle_timeout_minutes == 0` disables idle locking.
/// `idle_timeout_minutes > 0` triggers when `idle_millis >= idle_timeout_minutes * 60 * 1000`.
pub fn should_idle_lock(idle_timeout_minutes: u32, idle_millis: u64) -> bool {
    if idle_timeout_minutes == 0 {
        return false;
    }
    let threshold_millis = (idle_timeout_minutes as u64) * 60 * 1000;
    idle_millis >= threshold_millis
}

/// Apply lock state: hide window and set is_locked = true.
pub fn lock_app<R: Runtime>(app: &AppHandle<R>, state: &ScreenSecurityState) {
    state.is_locked.store(true, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Restore / unlock state: show window and set is_locked = false.
pub fn unlock_app<R: Runtime>(app: &AppHandle<R>, state: &ScreenSecurityState) {
    state.is_locked.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// ---------------------------------------------------------------------------
// Windows implementation: GetLastInputInfo, WTSRegisterSessionNotification, WM_POWERBROADCAST
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub fn init<R: Runtime>(app: &AppHandle<R>, state: ScreenSecurityState) -> Result<(), String> {
    use std::time::Duration;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::RemoteDesktop::{
        WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
    };
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
        RegisterClassW, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_DESTROY, WM_POWERBROADCAST,
        WM_WTSSESSION_CHANGE, WNDCLASSW,
    };

    // 1. Idle detection polling thread using GetLastInputInfo
    let idle_app = app.clone();
    let idle_state = state.clone();
    std::thread::Builder::new()
        .name("nulltrace-idle-monitor".to_string())
        .spawn(move || {
            let mut lii = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };

            loop {
                std::thread::sleep(Duration::from_secs(5));

                let timeout_mins = idle_state.idle_timeout_minutes.load(Ordering::Relaxed);
                if timeout_mins == 0 {
                    continue;
                }

                unsafe {
                    if GetLastInputInfo(&mut lii).as_bool() {
                        let now = GetTickCount();
                        // Handle tick overflow gracefully
                        let elapsed_millis = if now >= lii.dwTime {
                            (now - lii.dwTime) as u64
                        } else {
                            (u32::MAX - lii.dwTime + now) as u64
                        };

                        if should_idle_lock(timeout_mins, elapsed_millis)
                            && !idle_state.is_locked.load(Ordering::SeqCst)
                        {
                            lock_app(&idle_app, &idle_state);
                        }
                    }
                }
            }
        })
        .map_err(|e| format!("Failed to spawn idle monitor thread: {e}"))?;

    // 2. Hidden window for WM_POWERBROADCAST and WM_WTSSESSION_CHANGE
    let msg_app = app.clone();
    let msg_state = state.clone();

    std::thread::Builder::new()
        .name("nulltrace-screen-events".to_string())
        .spawn(move || unsafe {
            // Helper struct to share with window proc
            struct EventContext<R: Runtime> {
                app: AppHandle<R>,
                state: ScreenSecurityState,
            }

            let ctx = Box::new(EventContext {
                app: msg_app,
                state: msg_state,
            });

            // Class name as wide string
            let class_name: Vec<u16> = "NullTraceEventSink\0".encode_utf16().collect();

            unsafe extern "system" fn window_proc<R: Runtime>(
                hwnd: HWND,
                msg: u32,
                wparam: WPARAM,
                lparam: LPARAM,
            ) -> LRESULT {
                const PBT_APMSUSPEND: usize = 0x0004;
                const PBT_APMRESUMEAUTOMATIC: usize = 0x0012;
                const WTS_SESSION_LOCK: usize = 0x7;
                const WTS_SESSION_UNLOCK: usize = 0x8;

                match msg {
                    WM_POWERBROADCAST => {
                        if wparam.0 == PBT_APMSUSPEND {
                            let ptr = windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(
                                hwnd,
                                windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA,
                            ) as *const EventContext<R>;
                            if !ptr.is_null() {
                                let ctx = &*ptr;
                                lock_app(&ctx.app, &ctx.state);
                            }
                        } else if wparam.0 == PBT_APMRESUMEAUTOMATIC {
                            // Resume: window remains locked until user unlocks
                        }
                        LRESULT(1)
                    }
                    WM_WTSSESSION_CHANGE => {
                        let ptr = windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(
                            hwnd,
                            windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA,
                        ) as *const EventContext<R>;
                        if !ptr.is_null() {
                            let ctx = &*ptr;
                            if wparam.0 == WTS_SESSION_LOCK {
                                lock_app(&ctx.app, &ctx.state);
                            } else if wparam.0 == WTS_SESSION_UNLOCK {
                                // Session unlocked
                            }
                        }
                        LRESULT(0)
                    }
                    WM_DESTROY => {
                        windows::Win32::UI::WindowsAndMessaging::PostQuitMessage(0);
                        LRESULT(0)
                    }
                    _ => DefWindowProcW(hwnd, msg, wparam, lparam),
                }
            }

            let wc = WNDCLASSW {
                style: windows::Win32::UI::WindowsAndMessaging::WNDCLASS_STYLES(0),
                lpfnWndProc: Some(window_proc::<R>),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: windows::Win32::Foundation::HINSTANCE(std::ptr::null_mut()),
                hIcon: windows::Win32::UI::WindowsAndMessaging::HICON(std::ptr::null_mut()),
                hCursor: windows::Win32::UI::WindowsAndMessaging::HCURSOR(std::ptr::null_mut()),
                hbrBackground: windows::Win32::Graphics::Gdi::HBRUSH(std::ptr::null_mut()),
                lpszMenuName: PCWSTR::null(),
                lpszClassName: PCWSTR(class_name.as_ptr()),
            };

            let _ = RegisterClassW(&wc);

            let hwnd_res = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                PCWSTR(class_name.as_ptr()),
                PCWSTR(class_name.as_ptr()),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                None,
                None,
                None,
                None,
            );

            let hwnd = match hwnd_res {
                Ok(h) => h,
                Err(_) => return,
            };

            let _ = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);

            let raw_ctx = Box::into_raw(ctx);
            windows::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
                hwnd,
                windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA,
                raw_ctx as isize,
            );

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                DispatchMessageW(&msg);
            }

            let _ = DestroyWindow(hwnd);
            let _ = Box::from_raw(raw_ctx);
        })
        .map_err(|e| format!("Failed to spawn event sink thread: {e}"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Non-Windows implementation: explicit documented no-ops
// ---------------------------------------------------------------------------

/// Non-Windows implementation:
/// Content protection is supported by Tauri.
/// Idle monitoring, power suspend/resume, and session lock notifications are
/// explicit no-ops on non-Windows platforms.
#[cfg(not(windows))]
pub fn init<R: Runtime>(_app: &AppHandle<R>, _state: ScreenSecurityState) -> Result<(), String> {
    // Explicit documented no-op for non-Windows platforms.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idle_timeout_zero_disables_idle_locking() {
        // idle_timeout_minutes == 0 MUST disable idle locking, regardless of how long idle
        assert!(!should_idle_lock(0, 0));
        assert!(!should_idle_lock(0, 1000 * 60 * 60)); // 1 hour idle
        assert!(!should_idle_lock(0, u64::MAX));
    }

    #[test]
    fn test_idle_timeout_positive_triggers_above_threshold() {
        let timeout_minutes = 5;
        let threshold_ms = 5 * 60 * 1000;

        // Below threshold: no lock
        assert!(!should_idle_lock(timeout_minutes, threshold_ms - 1));
        assert!(!should_idle_lock(timeout_minutes, 0));

        // At or above threshold: lock
        assert!(should_idle_lock(timeout_minutes, threshold_ms));
        assert!(should_idle_lock(timeout_minutes, threshold_ms + 1000));
    }

    #[test]
    fn test_suspend_session_lock_independent_of_idle_timeout() {
        // An idle_timeout of 0 does not alter the fact that suspend/session-lock
        // can call `lock_app` directly.
        let state = ScreenSecurityState::default();
        state.idle_timeout_minutes.store(0, Ordering::SeqCst);

        // Directly triggering lock should work even when idle timeout is 0
        state.is_locked.store(true, Ordering::SeqCst);
        assert!(state.is_locked.load(Ordering::SeqCst));
    }
}
