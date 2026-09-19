use parking_lot::Mutex;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Kills the backend when the shell dies, however the shell dies.
///
/// A Windows job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminates every process in
/// the job as soon as the last handle to the job closes — which happens when this process exits,
/// including a crash or a `taskkill /F` that never runs any teardown code.
///
/// Without it the backend outlives the shell. It then keeps the API port and the instance lock,
/// and the next launch is refused by the lock while a port probe reports the port as ready: the
/// app comes up as a window with no backend behind it, and the footer shows the version of the
/// stale build it attached to. That is a real failure this code produced, so the guarantee is
/// enforced by the OS rather than by remembering to run teardown.
#[cfg(target_os = "windows")]
struct BackendJob {
    handle: windows::Win32::Foundation::HANDLE,
}

// A `HANDLE` is a plain kernel handle value: it owns no thread-affine state, so moving it
// between threads and sharing it by reference are both sound. It must be `Send + Sync` because
// the manager holding it is shared through `Arc` as Tauri state.
#[cfg(target_os = "windows")]
unsafe impl Send for BackendJob {}
#[cfg(target_os = "windows")]
unsafe impl Sync for BackendJob {}

#[cfg(target_os = "windows")]
impl BackendJob {
    /// Creates a kill-on-close job and puts `child` in it.
    ///
    /// Returns `None` when the job cannot be created or the process cannot be assigned. That is
    /// deliberately not fatal: teardown still stops the backend, so a job failure degrades the
    /// crash-safety guarantee but must not stop the app from starting.
    fn adopt(child: &Child) -> Option<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_BASIC_LIMIT_INFORMATION,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows::core::PCWSTR;

        unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;

            let info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
                BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION {
                    LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    ..Default::default()
                },
                ..Default::default()
            };
            let configured = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                core::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if configured.is_err() {
                let _ = CloseHandle(job);
                return None;
            }

            let process = HANDLE(child.as_raw_handle() as *mut core::ffi::c_void);
            if AssignProcessToJobObject(job, process).is_err() {
                let _ = CloseHandle(job);
                return None;
            }

            Some(Self { handle: job })
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for BackendJob {
    fn drop(&mut self) {
        // Closing the last handle is what triggers the kill, so this is the mechanism itself
        // rather than tidy bookkeeping.
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.handle);
        }
    }
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
    /// The line the backend prints once it has BOUND the API port. Readiness is this line and
    /// nothing else: see the readiness loop in `start` for why a port probe cannot be used.
    pub readiness_line: String,
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
            readiness_line: "[antidetect] Local API listening on".to_string(),
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
    /// Kept alive for as long as the child runs. Dropping it is what kills the backend, so it
    /// must be cleared only when the child is already gone.
    #[cfg(target_os = "windows")]
    job: Mutex<Option<BackendJob>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            terminated: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "windows")]
            job: Mutex::new(None),
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

        // Take the crash-safety guarantee before anything can go wrong: from here on the OS
        // ends the backend whenever this process does, even without a teardown.
        #[cfg(target_os = "windows")]
        {
            *self.job.lock() = BackendJob::adopt(&child);
        }

        // Record the child, or nothing can ever stop it.
        //
        // This was missing: the process was spawned and immediately dropped on the floor, so
        // `self.child` stayed `None` for the whole session. Both stop paths (`terminate` and
        // `terminate_graceful`) take an early `return` when the slot is empty, so the backend
        // was never asked to shut down and never killed — it outlived every shell exit and kept
        // the API port and the `service.lock`, which is what turned the next launch into a
        // window attached to a stale backend. The job object above is the guarantee; this is
        // what lets the polite path (flush the database, then exit) run at all.
        *self.child.lock() = Some(child);

        let ready_flag = Arc::new(AtomicBool::new(false));
        let error_log = Arc::new(Mutex::new(Vec::<String>::new()));

        let ready_clone = Arc::clone(&ready_flag);
        let err_clone = Arc::clone(&error_log);

        let signal_pattern = config.readiness_line.clone();

        let stdout_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                println!("[sidecar:out] {}", line);
                if line.contains(&signal_pattern) {
                    ready_clone.store(true, Ordering::SeqCst);
                }
            }
        });

        let stderr_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[sidecar:err] {}", line);
                let mut log = err_clone.lock();
                if log.len() < 50 {
                    log.push(line);
                }
            }
        });



        let start_time = Instant::now();
        let timeout = config.readiness_timeout;
        let mut is_ready = false;

        // Readiness is the backend's own line on its own stdout, and nothing else.
        //
        // A port probe used to count as readiness as well, and that is what produced a window
        // with no backend behind it. A probe only asks whether SOMETHING accepts a connection
        // on the port; when an earlier backend had been orphaned and still held it, the probe
        // answered yes before our child had done anything. The shell then reported a successful
        // start, navigated the webview at that port, and served whatever older build was
        // listening there — the footer showed that build's version, and every request died with
        // "Failed to fetch" as soon as the orphan exited. Meanwhile this child was failing on
        // the instance lock, and its exit was never observed because the loop had already
        // stopped.
        //
        // The child is checked for exit FIRST, so a failure is reported with the reason the
        // backend printed rather than being mistaken for readiness.
        while start_time.elapsed() < timeout {
            let exit_status = {
                let mut lock = self.child.lock();
                if let Some(c) = lock.as_mut() {
                    match c.try_wait() {
                        Ok(Some(status)) => Some(status),
                        Ok(None) => None,
                        Err(e) => {
                            eprintln!("[sidecar] Failed to poll child process: {e}");
                            None
                        }
                    }
                } else {
                    // The child was taken away from under us (a concurrent terminate).
                    let logs = error_log.lock().join("\n");
                    return Err(format!("Backend process is no longer running. Logs:\n{logs}"));
                }
            };

            if let Some(status) = exit_status {
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                let logs = error_log.lock().join("\n");
                return Err(format!(
                    "Backend process exited with {status} before it became ready. Logs:\n{logs}"
                ));
            }

            if ready_flag.load(Ordering::SeqCst) {
                is_ready = true;
                break;
            }

            std::thread::sleep(Duration::from_millis(100));
        }

        if !is_ready {
            self.terminate();
            let logs = error_log.lock().join("\n");
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

        let mut lock = self.child.lock();
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
            let lock = self.child.lock();
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
                let mut lock = self.child.lock();
                if let Some(child) = lock.as_mut() {
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
            let mut lock = self.child.lock();
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
            let mut lock = self.child.lock();
            let _ = lock.take();
        }
    }
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
        assert_eq!(config.readiness_line, "[antidetect] Local API listening on");
    }

    #[test]
    fn test_sidecar_manager_new() {
        let manager = SidecarManager::new();
        assert!(!manager.terminated.load(Ordering::SeqCst));
        assert!(manager.child.lock().is_none());
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

    /// A listener that is NOT our child must never satisfy the readiness wait.
    ///
    /// This is the defect that shipped: an orphaned backend held the port, a bare connection
    /// probe reported readiness, and the shell attached its window to that stale build while its
    /// own child was dying on the instance lock. The port here is genuinely held by a listener
    /// this test owns, and the child is genuinely alive and printing nothing — the exact state
    /// the old probe misread as a healthy start.
    #[test]
    fn a_foreign_listener_does_not_satisfy_readiness() {
        use std::net::TcpListener;

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind a probe port");
        let port = listener.local_addr().unwrap().port();

        // A live process that stays up and prints nothing. `node -e` is used because the
        // sidecar is spawned as node + a script path; anything quiet would do.
        let manager = SidecarManager::new();
        let result = manager.start(SidecarConfig {
            port,
            script_path: Some(PathBuf::from("-e")),
            args: vec!["setTimeout(() => {}, 5000)".to_string()],
            readiness_timeout: Duration::from_millis(700),
            ..Default::default()
        });

        assert!(
            result.is_err(),
            "a foreign listener on port {port} was accepted as our own backend becoming ready"
        );
        drop(listener);
    }

    /// The positive path: the child's own line is what makes it ready.
    #[test]
    fn the_childs_own_line_satisfies_readiness() {
        let manager = SidecarManager::new();
        let result = manager.start(SidecarConfig {
            // A port nothing is listening on, so the line is the only thing that can succeed.
            port: 1,
            script_path: Some(PathBuf::from("-e")),
            args: vec![r#"console.log("[antidetect] Local API listening on http://127.0.0.1:1"); setTimeout(() => {}, 3000)"#.to_string()],
            readiness_timeout: Duration::from_secs(10),
            ..Default::default()
        });

        assert!(
            result.is_ok(),
            "the backend's own readiness line was not honoured: {result:?}"
        );
        manager.terminate();
    }

    /// Losing the shell must take the backend with it, and the backend must be RECORDED so the
    /// polite stop path works at all.
    ///
    /// Both halves are asserted here, because they are the two defects that produced the
    /// operator's window-with-no-backend:
    ///
    /// 1. `self.child` holds the spawned process. It used to be dropped on the floor, which made
    ///    `terminate` and `terminate_graceful` return immediately and leave the backend running.
    /// 2. Closing the manager closes the job handle, and the OS then kills the process in the
    ///    job. That is the guarantee for a crash or a `taskkill /F`, where no teardown runs.
    #[cfg(target_os = "windows")]
    #[test]
    fn the_backend_is_recorded_and_dies_with_the_shell() {
        let manager = SidecarManager::new();
        let result = manager.start(SidecarConfig {
            port: 1,
            script_path: Some(PathBuf::from("-e")),
            // Long-lived and quiet: nothing here should end it except the job closing.
            args: vec![r#"console.log("[antidetect] Local API listening on http://127.0.0.1:1"); setTimeout(() => {}, 60000)"#.to_string()],
            readiness_timeout: Duration::from_secs(10),
            ..Default::default()
        });
        assert!(result.is_ok(), "the backend did not become ready: {result:?}");

        // 1. It is recorded. Take the handle out so the exit can be observed after the job goes.
        let mut child = manager
            .child
            .lock()
            .take()
            .expect("the spawned backend was not recorded in the manager");
        assert!(
            child.try_wait().expect("poll the backend").is_none(),
            "the backend exited before the job was closed"
        );

        // 2. Closing the shell's hold on the job kills it.
        drop(manager);

        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = child.try_wait().expect("poll the backend") {
                // Only that it ENDED is asserted. The exit code a job-object kill reports is the
                // OS's business, not this contract's, and pinning it would be asserting the
                // implementation rather than the guarantee.
                println!("backend terminated by the job, status: {status}");
                return;
            }
            assert!(
                Instant::now() < deadline,
                "the backend outlived the job handle: the orphan defect is back"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}
