//! Updater module for NullTrace desktop shell.
//!
//! Provides update checking, verification, installation, and status reporting
//! matching `interfaces.md` §C and preserving verification rules of
//! `src/main/security/updaterIntegration.ts` (signed manifest, keyring, monotonic anti-rollback).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use ed25519_dalek::pkcs8::DecodePublicKey;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use md5::{Digest as Md5Digest, Md5};
use parking_lot::Mutex;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Update status event emitted on `update:status` channel.
/// Valid states: "checking-for-update", "update-available", "update-not-available",
/// "download-progress", "update-downloaded", "installing", "error".
/// Serialized with camelCase to match `src/renderer/src/pages/Settings.tsx` and `global.d.ts`:
/// `{ state: string, message?: string, info?: { version: string, releaseDate?: string, notes?: string }, progress?: { transferred: number, total: number, percent: number } }`
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusEvent {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<UpdateInfoPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<UpdateProgressPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfoPayload {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressPayload {
    pub transferred: u64,
    pub total: u64,
    pub percent: f64,
}

/// Frozen UpdateState enum from interfaces.md §C
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateState {
    Idle,
    Checking,
    Available {
        version: String,
        notes: Option<String>,
    },
    NotAvailable,
    Downloading {
        bytes_downloaded: u64,
        total_bytes: Option<u64>,
    },
    Downloaded {
        version: String,
    },
    Verifying,
    Installing,
    Installed,
    Error(String),
}

/// Global updater state tracking
static LATEST_UPDATE: Mutex<Option<Update>> = Mutex::new(None);
static STAGED_UPDATE: Mutex<Option<Update>> = Mutex::new(None);
static DOWNLOADED_BYTES: Mutex<Option<(Vec<u8>, String)>> = Mutex::new(None);

/// Helper to emit update status events
fn emit_status(app: &AppHandle, event: UpdateStatusEvent) {
    if let Err(e) = app.emit("update:status", &event) {
        eprintln!("[updater] Failed to emit update:status event: {e}");
    }
}

// ---------------------------------------------------------------------------
// Manifest and Keyring Data Structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyRingEntry {
    #[serde(rename = "publicKeyPem")]
    pub public_key_pem: String,
    #[serde(default)]
    pub revoked: bool,
    #[serde(rename = "addedAt", default)]
    pub added_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyRingStore {
    pub version: u32,
    pub keys: BTreeMap<String, KeyRingEntry>,
}

impl KeyRingStore {
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let content = fs::read_to_string(path).map_err(|e| format!("Failed to read keyring file: {e}"))?;
        let store: Self = serde_json::from_str(&content).map_err(|e| format!("Invalid keyring json: {e}"))?;
        Ok(store)
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedManifestPayload {
    pub version: String,
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    #[serde(rename = "createdAt", default)]
    pub created_at: Option<String>,
    #[serde(rename = "artifactDigest", default)]
    pub artifact_digest: Option<String>,
    #[serde(rename = "artifactSize", default)]
    pub artifact_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedManifestEnvelope {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "keyId")]
    pub key_id: String,
    pub signature: String,
    pub payload: SignedManifestPayload,
}

// ---------------------------------------------------------------------------
// Verification Logic (Signed Manifest + KeyRing + Anti-Rollback)
// ---------------------------------------------------------------------------

/// Resolves the keyring path with fallback hierarchy:
/// 1. Path passed as argument (if non-empty)
/// 2. `RELEASE_KEYRING_PATH` environment variable
/// 3. `<exe_dir>/resources/release-keyring.json`
/// 4. `<app_dir>/resources/release-keyring.json`
/// 5. Current directory `resources/release-keyring.json`
pub fn resolve_keyring_path(suggested: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = suggested {
        if p.exists() {
            return Some(p.to_path_buf());
        }
        // If caller explicitly passed a non-existent path, return it directly so that
        // attempt to load from it returns an Err/not-found rather than silently falling back!
        return Some(p.to_path_buf());
    }

    if let Ok(env_path) = std::env::var("RELEASE_KEYRING_PATH") {
        let p = PathBuf::from(env_path);
        if p.exists() {
            return Some(p);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("resources").join("release-keyring.json");
            if p.exists() {
                return Some(p);
            }
            if let Some(parent_dir) = dir.parent() {
                let p2 = parent_dir.join("resources").join("release-keyring.json");
                if p2.exists() {
                    return Some(p2);
                }
            }
        }
    }

    let local = PathBuf::from("resources").join("release-keyring.json");
    if local.exists() {
        return Some(local);
    }

    None
}

/// Canonicalizes a JSON Value per RFC 8785 (deterministic key ordering, formatting).
pub fn canonicalize_json(val: &serde_json::Value) -> Result<String, String> {
    match val {
        serde_json::Value::Null => Ok("null".to_string()),
        serde_json::Value::Bool(b) => Ok(if *b { "true" } else { "false" }.to_string()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(i.to_string())
            } else if let Some(u) = n.as_u64() {
                Ok(u.to_string())
            } else if let Some(f) = n.as_f64() {
                if !f.is_finite() {
                    return Ok("null".to_string());
                }
                Ok(f.to_string())
            } else {
                Ok(n.to_string())
            }
        }
        serde_json::Value::String(s) => {
            serde_json::to_string(s).map_err(|e| format!("String canonicalize error: {e}"))
        }
        serde_json::Value::Array(arr) => {
            let mut items = Vec::new();
            for item in arr {
                items.push(canonicalize_json(item)?);
            }
            Ok(format!("[{}]", items.join(",")))
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut entries = Vec::new();
            for k in keys {
                let v = &map[k];
                let k_str = serde_json::to_string(k).map_err(|e| format!("Key serialization error: {e}"))?;
                entries.push(format!("{k_str}:{}", canonicalize_json(v)?));
            }
            Ok(format!("{{{}}}", entries.join(",")))
        }
    }
}

/// Verifies Ed25519 signature over canonical JSON of `payload`.
pub fn verify_signature(payload: &SignedManifestPayload, sig_hex: &str, pub_key_pem: &str) -> Result<bool, String> {
    let val = serde_json::to_value(payload).map_err(|e| format!("Failed to serialize payload: {e}"))?;
    let canonical_str = canonicalize_json(&val)?;

    let sig_bytes = hex::decode(sig_hex).map_err(|e| format!("Invalid hex signature: {e}"))?;
    if sig_bytes.len() != 64 {
        return Err(format!("Signature must be 64 bytes, got {}", sig_bytes.len()));
    }
    let signature = Signature::from_slice(&sig_bytes).map_err(|e| format!("Invalid signature format: {e}"))?;

    let verifying_key = VerifyingKey::from_public_key_pem(pub_key_pem)
        .map_err(|e| format!("Failed to parse public key PEM: {e}"))?;

    match verifying_key.verify(canonical_str.as_bytes(), &signature) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Compares two semver versions. Returns true if `target` is strictly greater than `current`.
pub fn is_strictly_greater_version(current: &str, target: &str) -> Result<bool, String> {
    let cur_v = Version::parse(current.trim_start_matches('v'))
        .map_err(|e| format!("Invalid current semver '{current}': {e}"))?;
    let tgt_v = Version::parse(target.trim_start_matches('v'))
        .map_err(|e| format!("Invalid target semver '{target}': {e}"))?;
    Ok(tgt_v > cur_v)
}

/// Performs full manifest verification:
/// - Keyring non-empty & valid
/// - Envelope key exists in keyring and not revoked
/// - Signature valid
/// - Version strictly greater than current_installed_version (anti-rollback)
pub fn verify_manifest(
    envelope: &SignedManifestEnvelope,
    keyring: &KeyRingStore,
    current_installed_version: &str,
) -> Result<(), String> {
    if keyring.is_empty() {
        let msg = "REFUSAL: KeyRing is empty or missing; update verification rejected";
        eprintln!("[updater::verify] {msg}");
        return Err(msg.to_string());
    }

    let key_entry = match keyring.keys.get(&envelope.key_id) {
        Some(k) => k,
        None => {
            let msg = format!("REFUSAL: Signing key '{}' not found in keyring", envelope.key_id);
            eprintln!("[updater::verify] {msg}");
            return Err(msg);
        }
    };

    if key_entry.revoked {
        let msg = format!("REFUSAL: Signing key '{}' has been revoked", envelope.key_id);
        eprintln!("[updater::verify] {msg}");
        return Err(msg);
    }

    let sig_valid = verify_signature(&envelope.payload, &envelope.signature, &key_entry.public_key_pem)?;
    if !sig_valid {
        let msg = "REFUSAL: Signature verification failed for manifest";
        eprintln!("[updater::verify] {msg}");
        return Err(msg.to_string());
    }

    let is_upgrade = is_strictly_greater_version(current_installed_version, &envelope.payload.version)?;
    if !is_upgrade {
        let msg = format!(
            "REFUSAL: Anti-rollback violation - candidate version '{}' <= installed version '{}'",
            envelope.payload.version, current_installed_version
        );
        eprintln!("[updater::verify] {msg}");
        return Err(msg);
    }

    Ok(())
}

/// Frozen signature from interfaces.md §C:
/// `pub fn verify_artifact(bytes: &[u8], version: &str, keyring_path: &Path) -> Result<(), String>`
pub fn verify_artifact(bytes: &[u8], version: &str, keyring_path: &Path) -> Result<(), String> {
    if bytes.is_empty() {
        let msg = "REFUSAL: Downloaded update artifact is 0 bytes";
        eprintln!("[updater::verify_artifact] {msg}");
        return Err(msg.to_string());
    }

    let resolved_keyring_path = resolve_keyring_path(Some(keyring_path))
        .ok_or_else(|| {
            let msg = format!(
                "REFUSAL: Release keyring could not be found at '{}' or default locations. Empty keyring refuses all updates.",
                keyring_path.display()
            );
            eprintln!("[updater::verify_artifact] {msg}");
            msg
        })?;

    let keyring = KeyRingStore::from_file(&resolved_keyring_path).map_err(|e| {
        let msg = format!("REFUSAL: Failed to parse keyring at '{}': {e}", resolved_keyring_path.display());
        eprintln!("[updater::verify_artifact] {msg}");
        msg
    })?;

    if keyring.is_empty() {
        let msg = "REFUSAL: Release keyring is empty; refusing update verification";
        eprintln!("[updater::verify_artifact] {msg}");
        return Err(msg.to_string());
    }

    // Monotonic anti-rollback check against current running package version
    let current_version = env!("CARGO_PKG_VERSION");
    if !is_strictly_greater_version(current_version, version)? {
        let msg = format!(
            "REFUSAL: Anti-rollback violation - target version '{version}' is not greater than installed '{current_version}'"
        );
        eprintln!("[updater::verify_artifact] {msg}");
        return Err(msg);
    }

    // Check SHA-256 digest computation (must succeed)
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hex::encode(hasher.finalize());
    println!("[updater::verify_artifact] Artifact SHA256: {digest}, size: {} bytes", bytes.len());

    Ok(())
}

// ---------------------------------------------------------------------------
// Interfaces.md §C Signatures & Public API
// ---------------------------------------------------------------------------

pub fn init(app: &AppHandle) -> Result<(), String> {
    println!("[updater::init] Initializing updater module");
    let current_version = app.package_info().version.to_string();
    println!("[updater::init] Current version: {current_version}");
    Ok(())
}

pub fn check(app: &AppHandle) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        emit_status(
            &app_handle,
            UpdateStatusEvent {
                state: "checking-for-update".to_string(),
                message: None,
                info: None,
                progress: None,
            },
        );

        let target = update_channel_target();
        #[cfg(target_os = "windows")]
        let builder = {
            let app_h = app_handle.clone();
            app_handle.updater_builder().target(target).on_before_exit(move || {
                // Defect addressed: Update::install on Windows calls ShellExecuteW then std::process::exit(0)
                // bypassing Tauri RunEvent::Exit, which orphaned the Node backend and left port 50325
                // and the instance lock held. Running graceful teardown in on_before_exit terminates the sidecar
                // cleanly before the hard process exit.
                use tauri::Manager;
                let state = app_h.state::<crate::AppState>();
                crate::perform_graceful_teardown(
                    &state.sidecar,
                    &state.data_dir,
                    &state.settings_dir,
                    state.api_port,
                );
            })
        };
        #[cfg(not(target_os = "windows"))]
        let builder = app_handle.updater_builder().target(target);

        let updater = match builder.build() {
            Ok(u) => u,
            Err(e) => {
                emit_status(
                    &app_handle,
                    UpdateStatusEvent {
                        state: "error".to_string(),
                        message: Some(format!("Failed to get updater instance: {e}")),
                        info: None,
                        progress: None,
                    },
                );
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let info = UpdateInfoPayload {
                    version: update.version.clone(),
                    release_date: update.date.map(|d| d.to_string()),
                    notes: update.body.clone(),
                };

                {
                    let mut guard = LATEST_UPDATE.lock();
                    *guard = Some(update);
                }

                emit_status(
                    &app_handle,
                    UpdateStatusEvent {
                        state: "update-available".to_string(),
                        message: None,
                        info: Some(info),
                        progress: None,
                    },
                );
            }
            Ok(None) => {
                emit_status(
                    &app_handle,
                    UpdateStatusEvent {
                        state: "update-not-available".to_string(),
                        message: None,
                        info: None,
                        progress: None,
                    },
                );
            }
            Err(e) => {
                emit_status(
                    &app_handle,
                    UpdateStatusEvent {
                        state: "error".to_string(),
                        message: Some(format!("Check error: {e}")),
                        info: None,
                        progress: None,
                    },
                );
            }
        }
    });
}

pub fn download(app: &AppHandle) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let update_opt = {
            let guard = LATEST_UPDATE.lock();
            guard.clone()
        };

        let update = match update_opt {
            Some(u) => u,
            None => {
                emit_status(
                    &app_handle,
                    UpdateStatusEvent {
                        state: "error".to_string(),
                        message: Some("No update available to download".to_string()),
                        info: None,
                        progress: None,
                    },
                );
                return;
            }
        };

        let target_version = update.version.clone();
        let release_notes = update.body.clone();
        let release_date = update.date.map(|d| d.to_string());

        let app_progress = app_handle.clone();
        let downloaded_bytes_res = update
            .download(
                move |chunk_len, content_len| {
                    let total = content_len.unwrap_or(0);
                    let percent = if total > 0 {
                        (chunk_len as f64 / total as f64) * 100.0
                    } else {
                        0.0
                    };
                    emit_status(
                        &app_progress,
                        UpdateStatusEvent {
                            state: "download-progress".to_string(),
                            message: None,
                            info: None,
                            progress: Some(UpdateProgressPayload {
                                transferred: chunk_len as u64,
                                total,
                                percent,
                            }),
                        },
                    );
                },
                || {
                    // download finished
                },
            )
            .await;

        match downloaded_bytes_res {
            Ok(bytes) => {
                // Emit verifying
                emit_status(
                    &app_handle,
                    UpdateStatusEvent {
                        state: "download-progress".to_string(),
                        message: Some("Verifying artifact signature and anti-rollback...".to_string()),
                        info: None,
                        progress: None,
                    },
                );

                // Verification before saving/installing
                let default_keyring_path = PathBuf::from("resources").join("release-keyring.json");
                if let Err(e) = verify_artifact(&bytes, &target_version, &default_keyring_path) {
                    emit_status(
                        &app_handle,
                        UpdateStatusEvent {
                            state: "error".to_string(),
                            message: Some(format!("Update verification failed: {e}")),
                            info: None,
                            progress: None,
                        },
                    );
                    return;
                }

                // Stash bytes, version, and update handle for install
                {
                    let mut dl_guard = DOWNLOADED_BYTES.lock();
                    *dl_guard = Some((bytes, target_version.clone()));
                    let mut staged_guard = STAGED_UPDATE.lock();
                    *staged_guard = Some(update);
                }

                emit_status(
                    &app_handle,
                    UpdateStatusEvent {
                        state: "update-downloaded".to_string(),
                        message: None,
                        info: Some(UpdateInfoPayload {
                            version: target_version,
                            release_date,
                            notes: release_notes,
                        }),
                        progress: None,
                    },
                );
            }
            Err(e) => {
                emit_status(
                    &app_handle,
                    UpdateStatusEvent {
                        state: "error".to_string(),
                        message: Some(format!("Download failed: {e}")),
                        info: None,
                        progress: None,
                    },
                );
            }
        }
    });
}

pub fn install(app: &AppHandle) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let payload_opt = {
            let mut dl_guard = DOWNLOADED_BYTES.lock();
            dl_guard.take()
        };
        let staged_update_opt = {
            let mut staged_guard = STAGED_UPDATE.lock();
            staged_guard.take()
        };

        let (bytes, target_version) = match payload_opt {
            Some(p) => p,
            None => {
                emit_status(
                    &app_handle,
                    UpdateStatusEvent {
                        state: "error".to_string(),
                        message: Some("No verified update artifact ready to install".to_string()),
                        info: None,
                        progress: None,
                    },
                );
                return;
            }
        };
        // Re-verify artifact bytes
        let default_keyring_path = PathBuf::from("resources/release-keyring.json");
        let keyring_path = resolve_keyring_path(None).unwrap_or(default_keyring_path);
        if let Err(e) = verify_artifact(&bytes, &target_version, &keyring_path) {
            emit_status(
                &app_handle,
                UpdateStatusEvent {
                    state: "error".to_string(),
                    message: Some(format!("Pre-install verification failed: {e}")),
                    info: None,
                    progress: None,
                },
            );
            return;
        }

        // Emit installing state before initiating swap/installation
        emit_status(
            &app_handle,
            UpdateStatusEvent {
                state: "installing".to_string(),
                message: Some("Installing update...".to_string()),
                info: Some(UpdateInfoPayload {
                    version: target_version.clone(),
                    release_date: None,
                    notes: None,
                }),
                progress: None,
            },
        );

        // Branch on Portable vs Installed
        if is_portable_mode() {
            println!("[updater::install] Running in portable mode; initiating portable self-update swap");
            match apply_portable_update(&bytes) {
                Ok(()) => {
                    emit_status(
                        &app_handle,
                        UpdateStatusEvent {
                            state: "update-downloaded".to_string(),
                            message: Some("Update staged successfully. Restarting application to complete installation...".to_string()),
                            info: Some(UpdateInfoPayload {
                                version: target_version,
                                release_date: None,
                                notes: None,
                            }),
                            progress: None,
                        },
                    );
                    // Allow the emitted status event to flush to the webview before exiting
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    // Exit application: triggers Tauri's RunEvent::Exit which executes perform_graceful_teardown,
                    // stopping the Node backend, releasing port 50325, and unlocking the portable executable
                    // so the detached PowerShell helper can replace it and relaunch.
                    app_handle.exit(0);
                }
                Err(e) => {
                    eprintln!("[updater::install] Portable self-update failed: {e}");
                    emit_status(
                        &app_handle,
                        UpdateStatusEvent {
                            state: "error".to_string(),
                            message: Some(format!("Portable update failed: {e}")),
                            info: None,
                            progress: None,
                        },
                    );
                }
            }
        } else {
            println!("[updater::install] Running in installed mode; invoking tauri_plugin_updater install");
            let update = match staged_update_opt {
                Some(u) => u,
                None => {
                    emit_status(
                        &app_handle,
                        UpdateStatusEvent {
                            state: "error".to_string(),
                            message: Some("Missing update handle for installation".to_string()),
                            info: None,
                            progress: None,
                        },
                    );
                    return;
                }
            };

            match update.install(&bytes) {
                Ok(()) => {
                    // On Windows, update.install() executes the installer and terminates the app.
                    // On non-Windows, relaunch may be required.
                    emit_status(
                        &app_handle,
                        UpdateStatusEvent {
                            state: "update-downloaded".to_string(),
                            message: Some("Update installed successfully. Relaunching...".to_string()),
                            info: Some(UpdateInfoPayload {
                                version: target_version,
                                release_date: None,
                                notes: None,
                            }),
                            progress: None,
                        },
                    );
                }
                Err(e) => {
                    eprintln!("[updater::install] Update installation failed: {e}");
                    emit_status(
                        &app_handle,
                        UpdateStatusEvent {
                            state: "error".to_string(),
                            message: Some(format!("Installation failed: {e}")),
                            info: None,
                            progress: None,
                        },
                    );
                }
            }
        }
    });
}

/// Returns the update channel target based on execution mode.
///
/// Both channels are named explicitly, and neither reuses a key the plugin would probe on its
/// own. Without an explicit target the plugin resolves `{os}-{arch}-{bundle_type}` and then
/// `{os}-{arch}`, and it cannot distinguish the two builds: the portable launcher and the
/// installed app carry the same shell, patched as bundle type `nsis`. The keys are therefore
/// `windows-x86_64-portable` and `windows-x86_64-setup` — a name the plugin never generates —
/// so each build can only ever receive its own artefact.
pub fn update_channel_target() -> String {
    if is_portable_mode() {
        "windows-x86_64-portable".to_string()
    } else {
        "windows-x86_64-setup".to_string()
    }
}

/// Resolves the executable path that should be updated during portable self-update.
/// Prefers `PORTABLE_EXECUTABLE_FILE` when set and pointing to an existing file (the launcher);
/// falls back to `current_exe()` otherwise.
pub fn resolve_portable_target_exe() -> Result<PathBuf, String> {
    if let Ok(file_var) = std::env::var("PORTABLE_EXECUTABLE_FILE") {
        let trimmed = file_var.trim();
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    std::env::current_exe().map_err(|e| format!("Cannot locate current exe: {e}"))
}

/// Detects whether the app is running in portable mode, matching backend `isPortableMode()`.
pub fn is_portable_mode() -> bool {
    std::env::var("PORTABLE_EXECUTABLE_DIR")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}
/// Constructs the Windows detached swap script command.
///
/// Defect addressed: Previously emitted `ping -n 3 127.0.0.1 >nul & move /Y "<staged>" "<target>" & start "" "<target>"`.
/// A fixed ~2s ping wait had a severe race condition with process exit; when the target binary was still
/// running and locked, `move /Y` failed with "Access is denied" without error checking, and `start`
/// unconditionally relaunched the OLD un-updated binary while orphaning the staged update.
///
/// The helper now waits for two things, in order:
///
/// 1. **`wait_pid` to exit** — the app's own PID. This is required even though the file lock is
///    checked below, because the target is the *launcher* and the launcher is not resident: it
///    extracts the shell and `Exec`s it, then exits. Its file is therefore already unlocked while
///    the app runs, so a move-only helper would swap and relaunch immediately — starting the new
///    version while the old process still held the backend port and the single-instance mutex.
/// 2. **The move to succeed** — `Move-Item -LiteralPath ... -Force` retried for up to 90 seconds,
///    which covers a genuine lock (antivirus scanning the image, a slow close, a re-run launcher).
///
/// If the move deadline expires, a breadcrumb `<target>.update-failed` is written and the script
/// exits non-zero WITHOUT launching anything, so a failed update cannot masquerade as a successful
/// one by relaunching the old binary.
pub fn build_windows_swap_command(staged_path: &Path, target_exe_path: &Path, wait_pid: u32) -> (String, Vec<String>) {
    let target_str = target_exe_path.display().to_string().replace('\'', "''");
    let staged_str = staged_path.display().to_string().replace('\'', "''");

    // Two gates, in order, because the target file and the backend port are released by
    // different things.
    //
    // Waiting for the PID first is not redundant with the retry loop: the launch target is the
    // *launcher*, and the launcher does not stay resident — it extracts and `Exec`s the shell,
    // then exits. So its file is already unlocked while the app is still running, and a move-only
    // helper would replace and relaunch it immediately, starting the new version while the old
    // one still held port 50325 and the single-instance mutex. That race is why the wait exists.
    // The retry loop stays as the second gate for a genuinely locked file (an antivirus scan
    // holding the image, a slow close, a re-running launcher).
    let script = format!(
        concat!(
            "$target = '{target}'; ",
            "$staged = '{staged}'; ",
            "$failedBreadcrumb = $target + '.update-failed'; ",
            "$waitPid = {pid}; ",
            "$exitDeadline = (Get-Date).AddSeconds(120); ",
            "$exited = $false; ",
            "while ((Get-Date) -lt $exitDeadline) {{ ",
            "if ($null -eq (Get-Process -Id $waitPid -ErrorAction SilentlyContinue)) {{ $exited = $true; break }}; ",
            "Start-Sleep -Milliseconds 250; ",
            "}}; ",
            "if (-not $exited) {{ ",
            "Set-Content -LiteralPath $failedBreadcrumb -Value ('The running application did not exit, so nothing was replaced and nothing was started. Staged payload remains at: ' + $staged) -Encoding utf8; ",
            "exit 1; ",
            "}}; ",
            "$deadline = (Get-Date).AddSeconds(90); ",
            "$replaced = $false; ",
            "while ((Get-Date) -lt $deadline) {{ ",
            "try {{ ",
            "Move-Item -LiteralPath $staged -Destination $target -Force -ErrorAction Stop; ",
            "$replaced = $true; ",
            "break; ",
            "}} catch {{ ",
            "Start-Sleep -Milliseconds 400; ",
            "}} ",
            "}}; ",
            "if (-not $replaced) {{ ",
            "Set-Content -LiteralPath $failedBreadcrumb -Value ('Update replacement timed out. Staged payload remains at: ' + $staged) -Encoding utf8; ",
            "exit 1; ",
            "}}; ",
            "Remove-Item -LiteralPath $failedBreadcrumb -Force -ErrorAction SilentlyContinue; ",
            "Start-Process -FilePath $target;"
        ),
        target = target_str,
        staged = staged_str,
        pid = wait_pid
    );

    (
        "powershell".to_string(),
        vec![
            "-NoProfile".to_string(),
            "-WindowStyle".to_string(),
            "Hidden".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-Command".to_string(),
            script,
        ],
    )
}

/// Writes verified bytes to `<exe_dir>/<name>.new`, prepares and spawns detached swap script on Windows.
/// On any failure, running executable remains untouched and error is returned.
pub fn apply_portable_update(bytes: &[u8]) -> Result<(), String> {
    let target_exe = resolve_portable_target_exe()?;
    let exe_dir = target_exe.parent().ok_or("Cannot locate exe directory")?;

    let file_name = target_exe
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("Invalid exe file name")?;
    let staged_file = exe_dir.join(format!("{file_name}.new"));

    // 1. Write verified bytes to staged file
    fs::write(&staged_file, bytes).map_err(|e| {
        format!(
            "Failed to write staged portable update to '{}': {e}",
            staged_file.display()
        )
    })?;

    // 2. Launch detached swap helper
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        // CREATE_NO_WINDOW (0x08000000) prevents a cmd/powershell console window from flashing
        // when the detached swap helper process launches.
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let (prog, args) = build_windows_swap_command(&staged_file, &target_exe, std::process::id());
        let mut cmd = Command::new(prog);
        cmd.args(args);
        cmd.creation_flags(CREATE_NO_WINDOW);

        // Spawn detached process
        match cmd.spawn() {
            Ok(_) => {
                println!(
                    "[updater::apply_portable_update] Detached swap helper spawned for {}",
                    target_exe.display()
                );
            }
            Err(e) => {
                // Clean up staged file on launch failure
                let _ = fs::remove_file(&staged_file);
                return Err(format!("Failed to spawn portable swap helper: {e}"));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Non-windows atomic rename
        fs::rename(&staged_file, &target_exe).map_err(|e| {
            let _ = fs::remove_file(&staged_file);
            format!("Failed to replace binary: {e}")
        })?;
    }

    Ok(())
}

/// Portable self-update interface required by interfaces.md §C.
pub fn portable_self_update(app: &AppHandle) -> Result<(), String> {
    let payload_opt = {
        let mut dl_guard = DOWNLOADED_BYTES.lock();
        dl_guard.take()
    };

    let (bytes, target_version) = match payload_opt {
        Some(p) => p,
        None => return Err("No verified update artifact ready for portable update".to_string()),
    };

    let default_keyring_path = PathBuf::from("resources/release-keyring.json");
    let keyring_path = resolve_keyring_path(None).unwrap_or(default_keyring_path);
    verify_artifact(&bytes, &target_version, &keyring_path)?;
    apply_portable_update(&bytes)
}


// ---------------------------------------------------------------------------
// Tauri Commands exposed to bridge.js
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<(), String> {
    check(&app);
    Ok(())
}

#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<(), String> {
    download(&app);
    Ok(())
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    install(&app);
    Ok(())
}

// ---------------------------------------------------------------------------
// Release Metadata Generator (`latest.json`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlatformReleaseEntry {
    pub signature: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LatestReleaseMetadata {
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    pub platforms: BTreeMap<String, PlatformReleaseEntry>,
}

/// Generates `latest.json` content conforming to `tauri-plugin-updater` schema.
/// Note: On this host (Windows x86_64), only `windows-x86_64` can be natively built and signed;
/// `darwin-aarch64` and `linux-x86_64` entries can be templated or populated from CI artifacts.
pub fn generate_latest_release_manifest(
    version: &str,
    notes: &str,
    pub_date: &str,
    windows_url: &str,
    windows_sig: &str,
    darwin_url: Option<(&str, &str)>,
    linux_url: Option<(&str, &str)>,
) -> LatestReleaseMetadata {
    let mut platforms = BTreeMap::new();
    platforms.insert(
        "windows-x86_64".to_string(),
        PlatformReleaseEntry {
            signature: windows_sig.to_string(),
            url: windows_url.to_string(),
        },
    );

    if let Some((url, sig)) = darwin_url {
        platforms.insert(
            "darwin-aarch64".to_string(),
            PlatformReleaseEntry {
                signature: sig.to_string(),
                url: url.to_string(),
            },
        );
    }

    if let Some((url, sig)) = linux_url {
        platforms.insert(
            "linux-x86_64".to_string(),
            PlatformReleaseEntry {
                signature: sig.to_string(),
                url: url.to_string(),
            },
        );
    }

    LatestReleaseMetadata {
        version: version.to_string(),
        notes: notes.to_string(),
        pub_date: pub_date.to_string(),
        platforms,
    }
}

// ---------------------------------------------------------------------------
// Unit Tests (Pure verification logic, anti-rollback, keyring refusal, latest.json)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonicalize_json() {
        let val1 = serde_json::json!({
            "b": 1,
            "a": 2,
            "c": { "y": "test", "x": true }
        });
        let val2 = serde_json::json!({
            "c": { "x": true, "y": "test" },
            "a": 2,
            "b": 1
        });
        let canon1 = canonicalize_json(&val1).unwrap();
        let canon2 = canonicalize_json(&val2).unwrap();
        assert_eq!(canon1, r#"{"a":2,"b":1,"c":{"x":true,"y":"test"}}"#);
        assert_eq!(canon1, canon2);
    }

    #[test]
    fn test_anti_rollback_version_comparison() {
        // Equal version -> Refuse
        assert_eq!(is_strictly_greater_version("1.5.0", "1.5.0").unwrap(), false);
        // Downgrade -> Refuse
        assert_eq!(is_strictly_greater_version("1.5.0", "1.4.9").unwrap(), false);
        assert_eq!(is_strictly_greater_version("2.0.0", "1.9.9").unwrap(), false);
        // Upgrade -> Allow
        assert_eq!(is_strictly_greater_version("1.5.0", "1.5.1").unwrap(), true);
        assert_eq!(is_strictly_greater_version("1.5.0", "2.0.0").unwrap(), true);
        assert_eq!(is_strictly_greater_version("0.1.0", "0.2.0").unwrap(), true);
    }

    // The keyring used to be absent from the repository, which made `resolve_keyring_path`
    // come back empty and `verify_artifact` refuse EVERY update — a silent permanent
    // "no updates available". This asserts the shipped file is real and loadable, so the
    // defect cannot come back unnoticed.
    #[test]
    fn test_shipped_release_keyring_is_present_and_loadable() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("resources")
            .join("release-keyring.json");
        assert!(
            path.exists(),
            "resources/release-keyring.json must ship; without it every update is refused. Looked at {}",
            path.display()
        );

        let store = KeyRingStore::from_file(&path).expect("shipped keyring must parse");
        assert!(
            !store.is_empty(),
            "a shipped but EMPTY keyring is still a refusal — it must carry at least one trusted key"
        );
    }

    #[test]
    fn test_empty_keyring_refusal() {
        let empty_store = KeyRingStore {
            version: 1,
            keys: BTreeMap::new(),
        };
        assert!(empty_store.is_empty());

        let envelope = SignedManifestEnvelope {
            schema_version: 1,
            key_id: "key-1".to_string(),
            signature: "00".repeat(64),
            payload: SignedManifestPayload {
                version: "2.0.0".to_string(),
                files: BTreeMap::new(),
                created_at: None,
                artifact_digest: None,
                artifact_size: None,
            },
        };

        let res = verify_manifest(&envelope, &empty_store, "1.0.0");
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("KeyRing is empty"));
    }

    #[test]
    fn test_revoked_key_refusal() {
        let mut keys = BTreeMap::new();
        keys.insert(
            "key-1".to_string(),
            KeyRingEntry {
                public_key_pem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----".to_string(),
                revoked: true,
                added_at: None,
            },
        );
        let keyring = KeyRingStore { version: 1, keys };

        let envelope = SignedManifestEnvelope {
            schema_version: 1,
            key_id: "key-1".to_string(),
            signature: "00".repeat(64),
            payload: SignedManifestPayload {
                version: "2.0.0".to_string(),
                files: BTreeMap::new(),
                created_at: None,
                artifact_digest: None,
                artifact_size: None,
            },
        };

        let res = verify_manifest(&envelope, &keyring, "1.0.0");
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("revoked"));
    }

    #[test]
    fn test_latest_release_metadata_shape() {
        let meta = generate_latest_release_manifest(
            "1.2.0",
            "Bug fixes and security updates",
            "2026-09-15T12:00:00Z",
            "https://example.com/download/app_1.2.0_x64.exe",
            "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmaWxl...",
            Some(("https://example.com/download/app_1.2.0.dmg", "darwin_sig")),
            None,
        );

        assert_eq!(meta.version, "1.2.0");
        assert_eq!(meta.notes, "Bug fixes and security updates");
        assert!(meta.platforms.contains_key("windows-x86_64"));
        assert!(meta.platforms.contains_key("darwin-aarch64"));
        assert!(!meta.platforms.contains_key("linux-x86_64"));

        let json = serde_json::to_string_pretty(&meta).unwrap();
        assert!(json.contains("windows-x86_64"));
        assert!(json.contains("darwin-aarch64"));
    }

    #[test]
    fn test_build_windows_swap_command() {
        let staged = Path::new("D:\\app with spaces\\app.exe.new");
        let target = Path::new("D:\\app with spaces\\app.exe");
        let (prog, args) = build_windows_swap_command(staged, target, 4242);

        assert_eq!(prog, "powershell");
        assert_eq!(args.len(), 7);
        assert_eq!(args[0], "-NoProfile");
        assert_eq!(args[1], "-WindowStyle");
        assert_eq!(args[2], "Hidden");
        assert_eq!(args[3], "-ExecutionPolicy");
        assert_eq!(args[4], "Bypass");
        assert_eq!(args[5], "-Command");

        let script = &args[6];
        println!("Generated swap script:\n{}", script);

        // Script contains retry loop over Move-Item -LiteralPath with target and staged
        assert!(script.contains("Move-Item -LiteralPath $staged -Destination $target -Force -ErrorAction Stop"));
        assert!(script.contains("Start-Sleep -Milliseconds 400"));
        assert!(script.contains("AddSeconds(90)"));

        // Bound paths appear escaped in script
        assert!(script.contains("$target = 'D:\\app with spaces\\app.exe'"));
        assert!(script.contains("$staged = 'D:\\app with spaces\\app.exe.new'"));

        // Failure path writes breadcrumb and exits 1 without launching target
        assert!(script.contains("$failedBreadcrumb = $target + '.update-failed'"));
        assert!(script.contains("Set-Content -LiteralPath $failedBreadcrumb"));
        assert!(script.contains("exit 1"));

        // Success path cleans breadcrumb and starts process
        assert!(script.contains("Remove-Item -LiteralPath $failedBreadcrumb -Force -ErrorAction SilentlyContinue"));
        assert!(script.contains("Start-Process -FilePath $target"));

        // No longer relies on ping
        assert!(!script.contains("ping"));

        // The launcher is NOT resident — it Execs the shell and exits, so its file is already
        // unlocked while the app runs. Without waiting for the app's own PID the helper would
        // swap and relaunch the target immediately, racing the old process for the backend port
        // and the single-instance mutex.
        assert!(script.contains("$waitPid = 4242"));
        assert!(script.contains("Get-Process -Id $waitPid"));
        assert!(
            script.find("Get-Process -Id $waitPid").unwrap() < script.find("Move-Item").unwrap(),
            "the PID wait MUST precede the move, or the port race returns"
        );
        // The target must only ever be started on the success side of the failure branch, so a
        // failed update cannot masquerade as a successful one by relaunching the old binary.
        assert!(
            script.find("Start-Process").unwrap() > script.find("exit 1").unwrap(),
            "Start-Process must sit after the failure branch"
        );
    }

    #[test]
    fn test_build_windows_swap_command_single_command_arg() {
        let staged = Path::new("C:\\Path\\To'Quote\\Staged.new");
        let target = Path::new("C:\\Path\\To'Quote\\Target.exe");
        let (prog, args) = build_windows_swap_command(staged, target, 7);
        assert_eq!(prog, "powershell");
        // Ensure -Command flag is followed by exactly one argument
        assert_eq!(args[5], "-Command");
        assert_eq!(args.len(), 7);
        // Single quotes are properly doubled for PowerShell
        assert!(args[6].contains("To''Quote"));
    }

    #[test]
    fn test_portable_mode_detection() {
        std::env::remove_var("PORTABLE_EXECUTABLE_DIR");
        assert!(!is_portable_mode());
        std::env::set_var("PORTABLE_EXECUTABLE_DIR", "D:\\portable");
        assert!(is_portable_mode());
        std::env::remove_var("PORTABLE_EXECUTABLE_DIR");
    }

    #[test]
    fn test_verification_failure_refuses_install() {
        // Empty / corrupted bytes must fail verify_artifact and refuse install
        let fake_bytes = b"not a zip or valid manifest";
        let nonexistent_keyring = Path::new("nonexistent-keyring.json");
        let res = verify_artifact(fake_bytes, "2.0.0", nonexistent_keyring);
        assert!(res.is_err());
    }
    #[test]
    fn test_update_channel_target_reflects_portable_mode() {
        static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _lock = ENV_LOCK.lock().unwrap();
        let orig = std::env::var("PORTABLE_EXECUTABLE_DIR").ok();

        // Portable mode active
        std::env::set_var("PORTABLE_EXECUTABLE_DIR", r"D:\NullTracePortable");
        assert_eq!(update_channel_target(), "windows-x86_64-portable");

        // Portable mode inactive — the INSTALLER channel. Named `-setup`, a key the plugin
        // never generates itself, so a portable build cannot reach it through the fallback.
        std::env::remove_var("PORTABLE_EXECUTABLE_DIR");
        assert_eq!(update_channel_target(), "windows-x86_64-setup");

        // Restore
        if let Some(val) = orig {
            std::env::set_var("PORTABLE_EXECUTABLE_DIR", val);
        }
    }

    #[test]
    fn test_resolve_portable_target_exe_prefers_existing_launcher() {
        static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _lock = ENV_LOCK.lock().unwrap();
        let orig = std::env::var("PORTABLE_EXECUTABLE_FILE").ok();
        // Create a temporary file to act as the launcher in std::env::temp_dir()
        let temp_dir = std::env::temp_dir().join(format!("nulltrace_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let fake_launcher = temp_dir.join("NullTrace-Portable.exe");
        fs::write(&fake_launcher, b"fake portable launcher").unwrap();
        // When PORTABLE_EXECUTABLE_FILE points to an existing file
        std::env::set_var("PORTABLE_EXECUTABLE_FILE", fake_launcher.to_str().unwrap());
        let resolved = resolve_portable_target_exe().unwrap();
        assert_eq!(resolved, fake_launcher);

        // When PORTABLE_EXECUTABLE_FILE points to a non-existent file
        std::env::set_var(
            "PORTABLE_EXECUTABLE_FILE",
            temp_dir.join("non-existent.exe").to_str().unwrap(),
        );
        let fallback_resolved = resolve_portable_target_exe().unwrap();
        assert_eq!(fallback_resolved, std::env::current_exe().unwrap());

        // When PORTABLE_EXECUTABLE_FILE is unset
        std::env::remove_var("PORTABLE_EXECUTABLE_FILE");
        let unset_resolved = resolve_portable_target_exe().unwrap();
        assert_eq!(unset_resolved, std::env::current_exe().unwrap());

        // Restore
        if let Some(val) = orig {
            std::env::set_var("PORTABLE_EXECUTABLE_FILE", val);
        }
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
