//! Sidecar lifecycle manager for the NullTrace backend.
//!
//! Controls launching the Node.js / TypeScript backend service,
//! observing readiness via stdout line matching or TCP port binding,
//! and ensuring child process termination on all exit routes.

use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Configuration parameters for the backend sidecar.
#[derive(Debug, Clone)]
pub struct SidecarConfig {
    pub port: u16,
    pub data_dir: Option<String>,
    pub binary_path: String,
    pub args: Vec<String>,
    pub readiness_timeout: Duration,
    pub readiness_signal: String,
}

impl Default for SidecarConfig {
    fn default() -> Self {
        Self {
            port: 50325,
            data_dir: None,
            binary_path: "node".to_string(),
            args: vec!["dist/electron/main.js".to_string()],
            readiness_timeout: Duration::from_secs(30),
            readiness_signal: "Server running at".to_string(),
        }
    }
}

/// Status of sidecar readiness wait.
#[derive(Debug, PartialEq, Eq)]
pub enum ReadinessStatus {
    ReadySignalObserved,
    PortBoundObserved,
    TimedOut,
    ProcessExitedEarly(Option<i32>),
}

/// Abstract representation of child process controller.
pub struct SidecarProcess {
    child: Option<Child>,
    config: SidecarConfig,
    is_terminated: Arc<AtomicBool>,
}

impl SidecarProcess {
    /// Spawn the sidecar child process with appropriate environment variables and piped stdout.
    pub fn spawn(config: SidecarConfig) -> std::io::Result<Self> {
        let mut cmd = Command::new(&config.binary_path);
        cmd.args(&config.args);
        cmd.env("API_PORT", config.port.to_string());
        if let Some(data_dir) = &config.data_dir {
            cmd.env("ANTIDETECT_DATA_DIR", data_dir);
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let child = cmd.spawn()?;
        Ok(Self {
            child: Some(child),
            config,
            is_terminated: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Construct from existing child (for mocking/testing).
    pub fn from_child(child: Child, config: SidecarConfig) -> Self {
        Self {
            child: Some(child),
            config,
            is_terminated: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Wait for backend readiness by observing stdout readiness signal or TCP port connectivity.
    pub fn wait_for_readiness(&mut self) -> ReadinessStatus {
        let start = Instant::now();
        let timeout = self.config.readiness_timeout;
        let signal = self.config.readiness_signal.clone();
        let port = self.config.port;

        // Check if child exited early
        if let Some(child) = &mut self.child {
            match child.try_wait() {
                Ok(Some(status)) => return ReadinessStatus::ProcessExitedEarly(status.code()),
                Err(_) => return ReadinessStatus::ProcessExitedEarly(None),
                Ok(None) => {}
            }
        } else {
            return ReadinessStatus::ProcessExitedEarly(None);
        }

        // Check if port is already open
        if check_port_open(port) {
            return ReadinessStatus::PortBoundObserved;
        }

        // Take stdout reader if available
        let mut stdout_reader = self.child.as_mut().and_then(|c| c.stdout.take()).map(BufReader::new);

        while start.elapsed() < timeout {
            // Check if child is still running
            if let Some(child) = &mut self.child {
                if let Ok(Some(status)) = child.try_wait() {
                    return ReadinessStatus::ProcessExitedEarly(status.code());
                }
            }

            // Check stdout for readiness signal if reader exists
            if let Some(reader) = &mut stdout_reader {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(n) if n > 0 => {
                        if line.contains(&signal) {
                            return ReadinessStatus::ReadySignalObserved;
                        }
                    }
                    _ => {}
                }
            }

            // Check TCP port connection
            if check_port_open(port) {
                return ReadinessStatus::PortBoundObserved;
            }

            std::thread::sleep(Duration::from_millis(50));
        }

        ReadinessStatus::TimedOut
    }

    /// Terminate the child process safely. Guaranteed idempotent.
    pub fn terminate(&mut self) -> std::io::Result<()> {
        if self.is_terminated.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        Ok(())
    }

    /// Check if terminated.
    pub fn is_terminated(&self) -> bool {
        self.is_terminated.load(Ordering::SeqCst)
    }

    /// Get target UI URL.
    pub fn ui_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.config.port)
    }

    /// Generates user-facing fallback HTML when backend fails to start.
    pub fn failure_html(reason: &str) -> String {
        format!(
            r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>NullTrace - Backend Startup Error</title>
    <style>
        body {{
            background: #0f172a;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }}
        .card {{
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 2rem;
            max-width: 500px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }}
        h2 {{ color: #ef4444; margin-top: 0; }}
        p {{ line-height: 1.5; color: #cbd5e1; }}
        code {{ background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.875rem; }}
    </style>
</head>
<body>
    <div class="card">
        <h2>Backend Service Error</h2>
        <p>The NullTrace background service failed to start:</p>
        <p><code>{}</code></p>
        <p>Please check if another instance is running or inspect the terminal logs.</p>
    </div>
</body>
</html>"#,
            reason
        )
    }
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

/// Helper function to check if a TCP port is accepting connections.
pub fn check_port_open(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        Duration::from_millis(50),
    ).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn test_sidecar_config_defaults() {
        let cfg = SidecarConfig::default();
        expect_eq(cfg.port, 50325);
        expect_eq(cfg.readiness_signal, "Server running at".to_string());
        assert!(cfg.data_dir.is_none());
    }

    #[test]
    fn test_failure_html_renders_reason() {
        let html = SidecarProcess::failure_html("Connection refused on port 50325");
        assert!(html.contains("Connection refused on port 50325"));
        assert!(html.contains("Backend Service Error"));
    }

    #[test]
    fn test_check_port_open_detects_listening_socket() {
        // Bind an ephemeral port
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().unwrap().port();

        assert!(check_port_open(port));
        drop(listener);
        // After drop, connection should fail
        assert!(!check_port_open(port));
    }

    #[test]
    fn test_readiness_detects_port_bound() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        // Spawn a dummy process that sleeps (e.g. ping or timeout on Windows, sleep on Unix)
        #[cfg(target_os = "windows")]
        let mut cmd = Command::new("cmd");
        #[cfg(target_os = "windows")]
        cmd.args(&["/c", "timeout /t 5 >nul"]);

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("sleep");
        #[cfg(not(target_os = "windows"))]
        cmd.arg("5");

        let child = cmd.spawn().expect("spawn sleep");
        let config = SidecarConfig {
            port,
            data_dir: None,
            binary_path: "dummy".to_string(),
            args: vec![],
            readiness_timeout: Duration::from_secs(2),
            readiness_signal: "READY".to_string(),
        };

        let mut sidecar = SidecarProcess::from_child(child, config);
        let status = sidecar.wait_for_readiness();
        expect_eq(status, ReadinessStatus::PortBoundObserved);

        // Teardown
        let _ = sidecar.terminate();
        assert!(sidecar.is_terminated());
    }

    #[test]
    fn test_readiness_detects_early_exit() {
        #[cfg(target_os = "windows")]
        let mut cmd = Command::new("cmd");
        #[cfg(target_os = "windows")]
        cmd.args(&["/c", "exit 42"]);

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("sh");
        #[cfg(not(target_os = "windows"))]
        cmd.args(&["-c", "exit 42"]);

        let child = cmd.spawn().expect("spawn exit");
        let config = SidecarConfig {
            port: 59999,
            data_dir: None,
            binary_path: "dummy".to_string(),
            args: vec![],
            readiness_timeout: Duration::from_secs(2),
            readiness_signal: "READY".to_string(),
        };

        let mut sidecar = SidecarProcess::from_child(child, config);
        // Wait for child to exit
        std::thread::sleep(Duration::from_millis(100));
        let status = sidecar.wait_for_readiness();
        match status {
            ReadinessStatus::ProcessExitedEarly(code) => {
                assert_eq!(code, Some(42));
            }
            other => panic!("expected ProcessExitedEarly, got {:?}", other),
        }

        assert!(!sidecar.is_terminated());
        let _ = sidecar.terminate();
        assert!(sidecar.is_terminated());
    }

    #[test]
    fn test_termination_is_idempotent() {
        #[cfg(target_os = "windows")]
        let mut cmd = Command::new("cmd");
        #[cfg(target_os = "windows")]
        cmd.args(&["/c", "timeout /t 5 >nul"]);

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("sleep");
        #[cfg(not(target_os = "windows"))]
        cmd.arg("5");

        let child = cmd.spawn().expect("spawn sleep");
        let config = SidecarConfig::default();
        let mut sidecar = SidecarProcess::from_child(child, config);

        assert!(!sidecar.is_terminated());
        assert!(sidecar.terminate().is_ok());
        assert!(sidecar.is_terminated());
        // Second call is safe and idempotent
        assert!(sidecar.terminate().is_ok());
        assert!(sidecar.is_terminated());
    }

    fn expect_eq<T: std::fmt::Debug + PartialEq>(a: T, b: T) {
        assert_eq!(a, b);
    }
}
