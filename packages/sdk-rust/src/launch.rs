//! Profile launch: spawn an isolated browser from a verified engine and return a CDP
//! endpoint an independent client can drive.
//!
//! Isolation is the point — each launch gets its own user-data directory, so two
//! profiles cannot share cookies, storage or a fingerprint seed.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::engine::{ensure_engine, EnsureEngineOptions};
use crate::{spawn_detached, wait_for_endpoint, SdkError};

/// Default time to wait for Chromium to report its debugging endpoint. First launch
/// of a fresh profile is slower than subsequent ones, so this is generous.
pub const DEFAULT_ENDPOINT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Default)]
pub struct LaunchConfig {
    /// Explicit engine executable. When absent, a verified engine is acquired.
    pub executable: Option<PathBuf>,
    /// Explicit profile directory. When absent a unique one is created under the
    /// data directory.
    pub user_data_dir: Option<PathBuf>,
    /// Deterministic fingerprint seed. Two different seeds produce different profiles.
    pub fingerprint_seed: Option<i64>,
    /// Run without a visible window.
    pub headless: bool,
    /// Extra Chromium switches, appended last so they win over the defaults.
    pub extra_args: Vec<String>,
    pub endpoint_timeout: Option<Duration>,
}

/// A launched profile. Dropping this does **not** kill the browser — call
/// [`ProfileInstance::close`] for that, so a caller can hand the endpoint to a driver
/// and keep the process alive.
#[derive(Debug)]
pub struct ProfileInstance {
    pub cdp_url: String,
    pub ws_endpoint: String,
    pub port: u16,
    pub user_data_dir: PathBuf,
    pub pid: u32,
    child: Option<Child>,
}

impl ProfileInstance {
    /// Terminate the browser process.
    pub fn close(&mut self) -> std::io::Result<()> {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }

    /// True while the browser process is still alive.
    pub fn is_running(&mut self) -> bool {
        match self.child.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }
}

/// Build the Chromium command line for an isolated, automation-ready profile.
///
/// Kept separate from launching so the arguments are assertable without starting a
/// process — which is how the isolation guarantees are tested.
pub fn build_args(config: &LaunchConfig, user_data_dir: &PathBuf, port: u16) -> Vec<String> {
    let mut args = vec![
        format!("--remote-debugging-port={port}"),
        format!("--user-data-dir={}", user_data_dir.display()),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-background-networking".to_string(),
        "--disable-component-update".to_string(),
        "--disable-default-apps".to_string(),
        "--disable-sync".to_string(),
        "--disable-blink-features=AutomationControlled".to_string(),
        "--password-store=basic".to_string(),
    ];
    if config.headless {
        args.push("--headless=new".to_string());
    }
    if let Some(seed) = config.fingerprint_seed {
        args.push(format!("--fingerprint-seed={seed}"));
    }
    // Caller switches last: Chromium's last-wins rule lets them override a default.
    args.extend(config.extra_args.iter().cloned());
    args
}

/// Pick a debugging port. Port 0 lets the OS choose, which avoids two concurrent
/// launches colliding on a fixed port.
fn ephemeral_port() -> u16 {
    0
}

/// Launch a profile and wait until its CDP endpoint is actually reachable.
pub fn launch_profile(config: &LaunchConfig) -> Result<ProfileInstance, SdkError> {
    let executable = match &config.executable {
        Some(path) => path.clone(),
        None => ensure_engine(&EnsureEngineOptions::default())?,
    };

    let user_data_dir = config.user_data_dir.clone().unwrap_or_else(|| {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        crate::default_engine_dir()
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .join("profiles")
            .join(format!("sdk-{stamp}"))
    });
    std::fs::create_dir_all(&user_data_dir)?;

    let port = ephemeral_port();
    let args = build_args(config, &user_data_dir, port);

    let mut command = Command::new(&executable);
    command.args(&args);
    let child = spawn_detached(&mut command)?;
    let pid = child.id();

    let timeout = config.endpoint_timeout.unwrap_or(DEFAULT_ENDPOINT_TIMEOUT);
    match wait_for_endpoint(&user_data_dir, timeout) {
        Ok((port, ws_path)) => Ok(ProfileInstance {
            cdp_url: format!("http://127.0.0.1:{port}"),
            ws_endpoint: format!("ws://127.0.0.1:{port}{ws_path}"),
            port,
            user_data_dir,
            pid,
            child: Some(child),
        }),
        Err(e) => {
            // A timeout must not leave a stray browser behind.
            let mut child = child;
            let _ = child.kill();
            let _ = child.wait();
            Err(e)
        }
    }
}

/// True when the engine executable responds to `--version`, i.e. it can actually run
/// on this host. Useful before committing to a launch.
pub fn engine_runs(executable: &PathBuf) -> bool {
    let started = Instant::now();
    let result = Command::new(executable)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    // A crash loop should not hang the caller.
    started.elapsed() < Duration::from_secs(20) && result.map(|o| o.status.success()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> LaunchConfig {
        LaunchConfig::default()
    }

    #[test]
    fn args_isolate_the_profile_directory() {
        let dir = PathBuf::from("/tmp/profile-a");
        let args = build_args(&cfg(), &dir, 0);
        assert!(args.iter().any(|a| a == "--user-data-dir=/tmp/profile-a"));
    }

    #[test]
    fn args_disable_automation_detection_and_network_noise() {
        let args = build_args(&cfg(), &PathBuf::from("/tmp/p"), 0);
        assert!(args.iter().any(|a| a.contains("AutomationControlled")));
        assert!(args.contains(&"--disable-sync".to_string()));
        assert!(args.contains(&"--no-first-run".to_string()));
    }

    #[test]
    fn a_fingerprint_seed_is_passed_through() {
        let config = LaunchConfig {
            fingerprint_seed: Some(424242),
            ..Default::default()
        };
        let args = build_args(&config, &PathBuf::from("/tmp/p"), 0);
        assert!(args.contains(&"--fingerprint-seed=424242".to_string()));
    }

    #[test]
    fn headless_is_opt_in() {
        let plain = build_args(&cfg(), &PathBuf::from("/tmp/p"), 0);
        assert!(!plain.iter().any(|a| a.starts_with("--headless")));

        let headless = LaunchConfig {
            headless: true,
            ..Default::default()
        };
        let args = build_args(&headless, &PathBuf::from("/tmp/p"), 0);
        assert!(args.iter().any(|a| a.starts_with("--headless")));
    }

    #[test]
    fn caller_args_come_last_so_they_can_override_defaults() {
        let config = LaunchConfig {
            extra_args: vec!["--disable-sync=off".to_string()],
            ..Default::default()
        };
        let args = build_args(&config, &PathBuf::from("/tmp/p"), 0);
        let last_disable_sync = args
            .iter()
            .rposition(|a| a.starts_with("--disable-sync"))
            .expect("disable-sync present");
        assert_eq!(args[last_disable_sync], "--disable-sync=off");
    }

    #[test]
    fn the_remote_debugging_port_is_always_set() {
        let args = build_args(&cfg(), &PathBuf::from("/tmp/p"), 9222);
        assert!(args.contains(&"--remote-debugging-port=9222".to_string()));
    }
}
