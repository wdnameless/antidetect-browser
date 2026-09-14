//! NullTrace standalone SDK — profile control and a CDP endpoint over the patched
//! Chromium engine, without the desktop application running.
//!
//! Scope is deliberately narrow: obtain the engine, launch an isolated profile, hand
//! back a CDP endpoint. There is no bundled stealth driver — the caller drives the
//! browser with whatever CDP client it prefers.
//!
//! The engine is **not** redistributed here. It is fetched on first use and verified
//! against a digest pinned in this crate, mirroring the application's own
//! `src/main/util/kernelAcquire.ts`. A test asserts the two tables agree, so they
//! cannot drift apart.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub mod engine;
pub mod launch;

pub use engine::{
    ensure_engine, AssetInfo, EngineError, EnsureEngineOptions, PINNED_KERNEL_VERSION,
    PINNED_PLATFORM_ASSETS, KERNEL_DOWNLOAD_BASE,
};
pub use launch::{launch_profile, LaunchConfig, ProfileInstance};

/// Errors surfaced by the SDK. Every variant names something the caller can act on
/// rather than wrapping a string nobody can branch on.
#[derive(Debug)]
pub enum SdkError {
    Engine(EngineError),
    /// The engine executable was not where the pinned asset said it would be.
    EngineMissing(PathBuf),
    /// The profile process started but never reported a debugging endpoint.
    EndpointTimeout { waited: Duration },
    Io(std::io::Error),
}

impl std::fmt::Display for SdkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SdkError::Engine(e) => write!(f, "engine acquisition failed: {e}"),
            SdkError::EngineMissing(p) => {
                write!(f, "engine executable not found at {}", p.display())
            }
            SdkError::EndpointTimeout { waited } => write!(
                f,
                "the profile started but reported no CDP endpoint within {:?}",
                waited
            ),
            SdkError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for SdkError {}

impl From<EngineError> for SdkError {
    fn from(e: EngineError) -> Self {
        SdkError::Engine(e)
    }
}

impl From<std::io::Error> for SdkError {
    fn from(e: std::io::Error) -> Self {
        SdkError::Io(e)
    }
}

/// Spawn `command` and return the child, wiring stdio so a caller can read progress.
pub(crate) fn spawn_detached(command: &mut Command) -> std::io::Result<Child> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

/// Resolve the directory engines are cached in. Mirrors the application: an explicit
/// data directory wins, otherwise the conventional per-user location.
pub fn default_engine_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ANTIDETECT_DATA_DIR") {
        if !dir.is_empty() {
            return Path::new(&dir).join("chromium");
        }
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".antidetect").join("chromium")
}

/// Wait until a CDP endpoint file appears for a profile, or the deadline passes.
///
/// Chromium writes `DevToolsActivePort` into the profile's user-data directory once
/// the debugging server is listening. Polling that file is what makes the returned
/// endpoint real rather than assumed.
pub fn wait_for_endpoint(
    user_data_dir: &Path,
    timeout: Duration,
) -> Result<(u16, String), SdkError> {
    let port_file = user_data_dir.join("DevToolsActivePort");
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(contents) = std::fs::read_to_string(&port_file) {
            let mut lines = contents.lines();
            if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                if let Ok(port) = port.trim().parse::<u16>() {
                    return Ok((port, path.trim().to_string()));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(SdkError::EndpointTimeout { waited: timeout })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_dir_honours_the_data_dir_override() {
        std::env::set_var("ANTIDETECT_DATA_DIR", "/tmp/nulltrace-test-data");
        let dir = default_engine_dir();
        std::env::remove_var("ANTIDETECT_DATA_DIR");
        assert!(dir.ends_with("chromium"));
        assert!(dir.to_string_lossy().contains("nulltrace-test-data"));
    }

    #[test]
    fn endpoint_wait_reports_a_timeout_rather_than_hanging() {
        let dir = std::env::temp_dir().join("nulltrace-no-endpoint");
        let _ = std::fs::create_dir_all(&dir);
        let started = Instant::now();
        let result = wait_for_endpoint(&dir, Duration::from_millis(300));
        assert!(matches!(result, Err(SdkError::EndpointTimeout { .. })));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn endpoint_wait_reads_the_real_port_file_format() {
        let dir = std::env::temp_dir().join("nulltrace-endpoint-ok");
        std::fs::create_dir_all(&dir).unwrap();
        // Chromium writes "<port>\n<browser ws path>".
        std::fs::write(dir.join("DevToolsActivePort"), "9222\n/devtools/browser/abc-123\n").unwrap();
        let (port, path) = wait_for_endpoint(&dir, Duration::from_secs(2)).unwrap();
        assert_eq!(port, 9222);
        assert_eq!(path, "/devtools/browser/abc-123");
    }
}
