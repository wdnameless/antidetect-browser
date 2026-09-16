use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub enum ReadinessSignal {
    RealString(String),
    PortBound,
}

#[derive(Debug, Clone)]
pub struct SidecarConfig {
    pub port: u16,
    pub settings_dir: PathBuf,
    pub resources_dir: Option<PathBuf>,
    pub node_path: Option<PathBuf>,
    pub script_path: Option<PathBuf>,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// The shell's own version, passed to the backend so it can report it.
    ///
    /// Tauri injects this from `tauri.conf.json` at build time, which makes it the only
    /// source that is correct in an INSTALLED build: the packaged artefacts do not ship
    /// `package.json`, so a backend reading the file worked in development and answered
    /// "unknown" on the operator's machine.
    pub app_version: Option<String>,
    pub readiness_timeout: Duration,
    pub readiness_signal: ReadinessSignal,
}

impl Default for SidecarConfig {
    fn default() -> Self {
        Self {
            port: 50325,
            settings_dir: default_settings_dir(),
            resources_dir: None,
            node_path: None,
            script_path: None,
            args: vec![],
            env: vec![],
            app_version: None,
            readiness_timeout: Duration::from_secs(15),
            readiness_signal: ReadinessSignal::RealString(
                "[antidetect] Local API listening on".to_string(),
            ),
        }
    }
}

pub fn default_settings_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("antidetect-browser");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("antidetect-browser");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(".config").join("antidetect-browser");
        }
    }
    PathBuf::from("data")
}

pub struct SidecarManager {
    child: Arc<Mutex<Option<Child>>>,
    terminated: Arc<AtomicBool>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            terminated: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(&self, config: SidecarConfig) -> Result<(), String> {
        let node_bin = config.node_path.unwrap_or_else(|| PathBuf::from("node"));

        let script = match config.script_path {
            Some(p) => p,
            None => {
                let mut candidates = Vec::new();
                if let Some(ref res) = config.resources_dir {
                    candidates.push(res.join("dist").join("src").join("main").join("index.js"));
                    candidates.push(res.join("_up_").join("dist").join("src").join("main").join("index.js"));
                }
                if let Ok(exe) = std::env::current_exe() {
                    if let Some(dir) = exe.parent() {
                        candidates.push(dir.join("dist").join("src").join("main").join("index.js"));
                        candidates.push(dir.join("..").join("dist").join("src").join("main").join("index.js"));
                        candidates.push(dir.join("..").join("..").join("dist").join("src").join("main").join("index.js"));
                        candidates.push(dir.join("..").join("..").join("..").join("dist").join("src").join("main").join("index.js"));
                    }
                }
                candidates.push(PathBuf::from("dist").join("src").join("main").join("index.js"));

                candidates
                    .into_iter()
                    .find(|p| p.exists())
                    .map(|p| p.canonicalize().unwrap_or(p))
                    .unwrap_or_else(|| PathBuf::from("dist").join("src").join("main").join("index.js"))
            }
        };

        if !node_bin.exists() && node_bin != PathBuf::from("node") {
            return Err(format!("Node runtime not found at: {}", node_bin.display()));
        }

        let script_arg = {
            let s = script.to_string_lossy();
            if let Some(stripped) = s.strip_prefix(r"\\?\") {
                stripped.to_string()
            } else {
                s.to_string()
            }
        };
        let mut cmd = Command::new(&node_bin);
        cmd.arg(&script_arg);
        cmd.args(&config.args);

        // The backend reads `API_PORT` (src/main/config.ts:110). Passing `PORT` here silently
        // left the service on its default 50325 while the shell navigated the webview at the
        // port it *thought* it had chosen — a mismatch that only shows up when the port is
        // overridden. Keep the name in lockstep with config.ts.
        cmd.env("API_PORT", config.port.to_string());
        cmd.env("API_HOST", "127.0.0.1");
        cmd.env("ANTIDETECT_SETTINGS_DIR", &config.settings_dir);
        if let Some(ref v) = config.app_version {
            cmd.env("ANTIDETECT_APP_VERSION", v);
        }
        if let Some(ref res) = config.resources_dir {
            cmd.env("ANTIDETECT_TARGET_RESOURCES_DIR", res);
        }

        // Packaged signal (SECURITY-CRITICAL): refuse --allow-unsigned-dev in production.
        for (k, v) in build_mode_env_vars() {
            cmd.env(k, v);
        }
        // Populate NODE_PATH so vendored node finds node_modules in both installed/portable bundles and dev
        let mut node_paths = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                node_paths.push(parent.join("node_modules"));
                node_paths.push(parent.join("resources").join("node_modules"));
            }
        }
        if let Some(ref res) = config.resources_dir {
            node_paths.push(res.join("node_modules"));
        }
        if let Some(script_dir) = script.parent() {
            node_paths.push(script_dir.join("node_modules"));
            if let Some(parent) = script_dir.parent() {
                node_paths.push(parent.join("node_modules"));
                if let Some(gparent) = parent.parent() {
                    node_paths.push(gparent.join("node_modules"));
                }
            }
        }
        let delimiter = if cfg!(target_os = "windows") { ";" } else { ":" };
        let node_path_val = node_paths
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(delimiter);
        cmd.env("NODE_PATH", node_path_val);

        for (k, v) in &config.env {
            cmd.env(k, v);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW prevents opening a console window;
            // Job object or process hierarchy ensures kill on exit.
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn backend process (node: {}, script: {}): {}",
                node_bin.display(),
                script.display(),
                e
            )
        })?;

        let stdout = child.stdout.take().ok_or("Failed to capture child stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture child stderr")?;

        let ready_flag = Arc::new(AtomicBool::new(false));
        let error_log = Arc::new(Mutex::new(Vec::<String>::new()));

        let ready_clone = Arc::clone(&ready_flag);
        let err_clone = Arc::clone(&error_log);

        let signal_pattern = match &config.readiness_signal {
            ReadinessSignal::RealString(s) => Some(s.clone()),
            ReadinessSignal::PortBound => None,
        };

        let stdout_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                println!("[sidecar:out] {}", line);
                if let Some(ref pattern) = signal_pattern {
                    if line.contains(pattern) {
                        ready_clone.store(true, Ordering::SeqCst);
                    }
                }
            }
        });

        let stderr_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[sidecar:err] {}", line);
                let mut log = err_clone.lock().unwrap();
                if log.len() < 50 {
                    log.push(line);
                }
            }
        });



        let start_time = Instant::now();
        let timeout = config.readiness_timeout;
        let mut is_ready = false;

        while start_time.elapsed() < timeout {
            if ready_flag.load(Ordering::SeqCst) {
                is_ready = true;
                break;
            }

            if check_port(config.port) {
                is_ready = true;
                break;
            }

            {
                let mut lock = self.child.lock().unwrap();
                if let Some(ref mut c) = *lock {
                    match c.try_wait() {
                        Ok(Some(status)) => {
                            let _ = stdout_thread.join();
                            let _ = stderr_thread.join();
                            let logs = error_log.lock().unwrap().join("\n");
                            let pid = c.id();
                            return Err(format!(
                                "Backend process (PID {pid}) exited prematurely with {status}. Logs:\n{logs}"
                            ));
                        }
                        Ok(None) => {}
                        Err(e) => {
                            eprintln!("[sidecar] Failed to poll child process: {e}");
                        }
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(100));
        }

        if !is_ready {
            self.terminate();
            let logs = error_log.lock().unwrap().join("\n");
            return Err(format!(
                "Backend process failed to signal readiness within {:?}. Captured errors:\n{}",
                timeout, logs
            ));
        }

        Ok(())
    }

    pub fn terminate(&self) {
        if self.terminated.swap(true, Ordering::SeqCst) {
            return;
        }

        let mut lock = self.child.lock().unwrap();
        if let Some(mut child) = lock.take() {
            let pid = child.id();

            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/pid", &pid.to_string(), "/T", "/F"])
                    .output();
            }

            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn terminate_graceful(&self, port: u16, api_key: Option<&str>) {
        if self.terminated.swap(true, Ordering::SeqCst) {
            return;
        }
        let pid_opt = {
            let lock = self.child.lock().unwrap();
            lock.as_ref().map(|c| c.id())
        };

        let pid = match pid_opt {
            Some(p) => p,
            None => return,
        };

        // Step 1: Request graceful shutdown via HTTP POST /api/v1/shutdown
        let _shutdown_url = format!("http://127.0.0.1:{port}/api/v1/shutdown");
        let client = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(500),
        );

        if let Ok(mut stream) = client {
            use std::io::Write;
            let mut req = format!(
                "POST /api/v1/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n"
            );
            if let Some(key) = api_key {
                req.push_str(&format!("Authorization: Bearer {key}\r\n"));
            }
            req.push_str("\r\n");
            let _ = stream.write_all(req.as_bytes());
            let _ = stream.flush();
        }

        // Step 2: Bounded wait (~5 seconds) for child to exit on its own
        let wait_start = Instant::now();
        let timeout = Duration::from_secs(5);
        let mut exited = false;

        while wait_start.elapsed() < timeout {
            {
                let mut lock = self.child.lock().unwrap();
                if let Some(ref mut child) = *lock {
                    match child.try_wait() {
                        Ok(Some(_status)) => {
                            exited = true;
                            break;
                        }
                        Ok(None) => {}
                        Err(_) => {}
                    }
                } else {
                    exited = true;
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        // Step 3: If child hasn't exited, fallback to kill process tree (taskkill /T /F)
        if !exited {
            eprintln!("[sidecar] Backend did not exit after graceful shutdown request within 5s, killing PID {pid}");
            let mut lock = self.child.lock().unwrap();
            if let Some(mut child) = lock.take() {
                #[cfg(target_os = "windows")]
                {
                    let _ = Command::new("taskkill")
                        .args(["/pid", &pid.to_string(), "/T", "/F"])
                        .output();
                }
                let _ = child.kill();
                let _ = child.wait();
            }
        } else {
            let mut lock = self.child.lock().unwrap();
            let _ = lock.take();
        }
    }
}
fn check_port(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(50),
    )
    .is_ok()
}

/// Returns the build mode environment variables to supply to the sidecar process.
/// In release builds (!debug_assertions), ANTIDETECT_PACKAGED=1 and NODE_ENV=production are set.
/// In debug builds, NODE_ENV=development is set without ANTIDETECT_PACKAGED.
pub fn build_mode_env_vars() -> Vec<(&'static str, &'static str)> {
    if !cfg!(debug_assertions) {
        vec![
            ("ANTIDETECT_PACKAGED", "1"),
            ("NODE_ENV", "production"),
        ]
    } else {
        vec![
            ("NODE_ENV", "development"),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sidecar_config_default() {
        let config = SidecarConfig::default();
        assert_eq!(config.port, 50325);
        match config.readiness_signal {
            ReadinessSignal::RealString(ref s) => {
                assert_eq!(s, "[antidetect] Local API listening on");
            }
            _ => panic!("Expected RealString readiness signal"),
        }
    }

    #[test]
    fn test_sidecar_manager_new() {
        let manager = SidecarManager::new();
        assert!(!manager.terminated.load(Ordering::SeqCst));
        assert!(manager.child.lock().unwrap().is_none());
    }

    #[test]
    fn test_sidecar_manager_terminate_idempotent() {
        let manager = SidecarManager::new();
        manager.terminate();
        assert!(manager.terminated.load(Ordering::SeqCst));
        manager.terminate();
        assert!(manager.terminated.load(Ordering::SeqCst));
    }

    #[test]
    fn test_default_settings_dir_not_empty() {
        let dir = default_settings_dir();
        assert!(!dir.as_os_str().is_empty());
    }
    #[test]
    fn test_packaged_signal_env_vars() {
        let envs = build_mode_env_vars();
        if cfg!(debug_assertions) {
            assert_eq!(envs, vec![("NODE_ENV", "development")]);
        } else {
            assert_eq!(envs, vec![
                ("ANTIDETECT_PACKAGED", "1"),
                ("NODE_ENV", "production"),
            ]);
        }
    }
}
