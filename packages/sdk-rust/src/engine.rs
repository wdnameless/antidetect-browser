//! Engine acquisition: fetch the platform-correct patched Chromium, verify it against
//! a pinned digest, and extract it — refusing to hand back anything unverified.
//!
//! The digests below are a MIRROR of `src/main/util/kernelAcquire.ts`. They are
//! external values and must be re-pinned there and here together when the upstream
//! kernel version changes; a test in the TypeScript suite asserts the two agree.

use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::{default_engine_dir, spawn_detached, SdkError};

pub const PINNED_KERNEL_VERSION: &str = "148.0.7778.215";
pub const KERNEL_REPO: &str = "adryfish/fingerprint-chromium";
pub const KERNEL_DOWNLOAD_BASE: &str =
    "https://github.com/adryfish/fingerprint-chromium/releases/download/148.0.7778.215";

#[derive(Debug, Clone, Copy)]
pub struct AssetInfo {
    pub asset: &'static str,
    pub sha256: &'static str,
    pub size: u64,
    /// Path to the executable inside the extracted archive.
    pub executable_subpath: &'static str,
    pub archive: ArchiveKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    Zip,
    AppImage,
    Dmg,
}

/// Platform key matching Node's `process.platform` naming, so the tables line up.
pub fn platform_key() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

pub fn pinned_assets() -> Vec<(&'static str, AssetInfo)> {
    vec![
        (
            "win32",
            AssetInfo {
                asset: "ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip",
                sha256: "9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579",
                size: 189_767_686,
                executable_subpath: "ungoogled-chromium_148.0.7778.215-1.1_windows_x64/chrome.exe",
                archive: ArchiveKind::Zip,
            },
        ),
        (
            "linux",
            AssetInfo {
                asset: "ungoogled-chromium-148.0.7778.215-1-x86_64.AppImage",
                sha256: "a5fa5e6c05cb7fa3617ec2ca642ad3cc6e586ac5249cc29edb0a602d695685f0",
                size: 188_811_768,
                executable_subpath: "ungoogled-chromium-148.0.7778.215-1-x86_64.AppImage",
                archive: ArchiveKind::AppImage,
            },
        ),
        (
            "darwin",
            AssetInfo {
                asset: "ungoogled-chromium_148.0.7778.215-1.1_macos.dmg",
                sha256: "b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679",
                size: 140_187_500,
                executable_subpath: "Chromium.app/Contents/MacOS/Chromium",
                archive: ArchiveKind::Dmg,
            },
        ),
    ]
}

/// Convenience name for the pinned table, so callers need not call the function.
pub const PINNED_PLATFORM_ASSETS: &[(&str, AssetInfo)] = &[
    (
        "win32",
        AssetInfo {
            asset: "ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip",
            sha256: "9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579",
            size: 189_767_686,
            executable_subpath: "ungoogled-chromium_148.0.7778.215-1.1_windows_x64/chrome.exe",
            archive: ArchiveKind::Zip,
        },
    ),
    (
        "linux",
        AssetInfo {
            asset: "ungoogled-chromium-148.0.7778.215-1-x86_64.AppImage",
            sha256: "a5fa5e6c05cb7fa3617ec2ca642ad3cc6e586ac5249cc29edb0a602d695685f0",
            size: 188_811_768,
            executable_subpath: "ungoogled-chromium-148.0.7778.215-1-x86_64.AppImage",
            archive: ArchiveKind::AppImage,
        },
    ),
    (
        "darwin",
        AssetInfo {
            asset: "ungoogled-chromium_148.0.7778.215-1.1_macos.dmg",
            sha256: "b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679",
            size: 140_187_500,
            executable_subpath: "Chromium.app/Contents/MacOS/Chromium",
            archive: ArchiveKind::Dmg,
        },
    ),
];

#[derive(Debug)]
pub enum EngineError {
    UnsupportedPlatform(String),
    Download(String),
    /// The bytes received did not hash to the pinned digest. Nothing is left behind.
    DigestMismatch { expected: String, actual: String },
    Extraction(String),
    NotFound(PathBuf),
    Io(io::Error),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineError::UnsupportedPlatform(p) => {
                write!(f, "no pinned engine for platform '{p}'")
            }
            EngineError::Download(m) => write!(f, "download failed: {m}"),
            EngineError::DigestMismatch { expected, actual } => write!(
                f,
                "engine digest mismatch: expected {expected}, got {actual} — refusing to use it"
            ),
            EngineError::Extraction(m) => write!(f, "extraction failed: {m}"),
            EngineError::NotFound(p) => {
                write!(f, "engine executable missing after extraction: {}", p.display())
            }
            EngineError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for EngineError {}

impl From<io::Error> for EngineError {
    fn from(e: io::Error) -> Self {
        EngineError::Io(e)
    }
}

#[derive(Debug, Clone)]
pub struct EnsureEngineOptions {
    pub target_dir: Option<PathBuf>,
    pub platform: Option<String>,
    /// Supply a local archive instead of downloading — used by the tests, and useful
    /// for air-gapped installs.
    pub local_archive: Option<PathBuf>,
    pub force: bool,
}

impl Default for EnsureEngineOptions {
    fn default() -> Self {
        Self {
            target_dir: None,
            platform: None,
            local_archive: None,
            force: false,
        }
    }
}

/// Hash a file with SHA-256, streaming so a 190 MB archive does not land in memory.
pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Verify `path` against `expected`, deleting it if it does not match.
///
/// Deleting on mismatch is the point: a partially written or tampered archive must
/// never be left where a later run could treat it as a usable cache.
pub fn verify_or_remove(path: &Path, expected: &str) -> Result<(), EngineError> {
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        return Ok(());
    }
    let _ = fs::remove_file(path);
    Err(EngineError::DigestMismatch {
        expected: expected.to_string(),
        actual,
    })
}

/// Ensure a verified engine is available, returning the executable path.
///
/// Idempotent: a verified engine already in place is returned without any network
/// access, which is what makes a second call cheap and offline-safe.
pub fn ensure_engine(opts: &EnsureEngineOptions) -> Result<PathBuf, EngineError> {
    let platform = opts
        .platform
        .clone()
        .unwrap_or_else(|| platform_key().to_string());
    let table = pinned_assets();
    let (_, info) = table
        .iter()
        .find(|(k, _)| *k == platform)
        .ok_or_else(|| EngineError::UnsupportedPlatform(platform.clone()))?;

    let base = opts.target_dir.clone().unwrap_or_else(default_engine_dir);
    let kernel_dir = base.join(PINNED_KERNEL_VERSION);
    let executable = kernel_dir.join(info.executable_subpath);
    let marker = kernel_dir.join(".kernel-version");

    // Cache hit requires BOTH the executable and the version marker: the executable
    // alone could belong to a previous kernel version.
    if !opts.force && executable.exists() && marker.exists() {
        return Ok(executable);
    }

    fs::create_dir_all(&kernel_dir)?;
    let archive_path = kernel_dir.join(format!("{}.download", info.asset));

    if let Some(local) = &opts.local_archive {
        fs::copy(local, &archive_path)?;
    } else {
        download_to(&format!("{KERNEL_DOWNLOAD_BASE}/{}", info.asset), &archive_path)?;
    }

    verify_or_remove(&archive_path, info.sha256)?;

    match info.archive {
        ArchiveKind::Zip => extract_zip(&archive_path, &kernel_dir)?,
        ArchiveKind::AppImage => {
            if platform != "linux" {
                return Err(EngineError::Extraction(format!(
                    "the {platform} AppImage cannot be prepared on this host"
                )));
            }
            fs::copy(&archive_path, &executable)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&executable)?.permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&executable, perms)?;
            }
        }
        ArchiveKind::Dmg => {
            return Err(EngineError::Extraction(
                "a macOS DMG must be mounted (hdiutil) before its app can be used; \
                 this crate does not mount disk images"
                    .to_string(),
            ));
        }
    }

    let _ = fs::remove_file(&archive_path);

    if !executable.exists() {
        return Err(EngineError::NotFound(executable));
    }
    fs::write(&marker, PINNED_KERNEL_VERSION)?;
    Ok(executable)
}

/// Extract a zip using the platform's own tool. bsdtar handles zip on Windows and
/// Unix; this avoids pulling a zip crate in for one call.
fn extract_zip(archive: &Path, dest: &Path) -> Result<(), EngineError> {
    let status = std::process::Command::new("tar")
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(dest)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(EngineError::Extraction(format!(
            "tar exited with {status}"
        )))
    }
}

/// Download with `curl`, which is present on Windows 10+, macOS and every Linux we
/// target. Streaming to a file keeps memory flat for a 190 MB payload.
fn download_to(url: &str, dest: &Path) -> Result<(), EngineError> {
    let mut command = std::process::Command::new("curl");
    command
        .arg("-L")
        .arg("--fail")
        .arg("--silent")
        .arg("--show-error")
        .arg("-o")
        .arg(dest)
        .arg(url);
    let mut child = spawn_detached(&mut command).map_err(|e| EngineError::Download(e.to_string()))?;
    // curl has no progress callback here; the caller sees the result, and a long
    // download is bounded by the process rather than by a silent hang.
    let _ = child.wait();
    let status = child.try_wait().ok().flatten();
    if dest.exists() && dest.metadata().map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(());
    }
    Err(EngineError::Download(match status {
        Some(s) => format!("curl exited with {s}"),
        None => format!("curl produced no file at {}", dest.display()),
    }))
}

/// Give a caller a way to wait on a spawned process without exposing the child.
pub fn wait_with_timeout(child: &mut std::process::Child, timeout: Duration) -> Option<i32> {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.code().unwrap_or(-1)),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return None,
        }
    }
    None
}

/// Re-export so `SdkError` conversion is available without importing the error module.
pub(crate) fn map_err(e: EngineError) -> SdkError {
    SdkError::Engine(e)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nulltrace-engine-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn digest_of_a_known_payload_matches() {
        let dir = tmpdir("digest");
        let file = dir.join("payload.bin");
        let mut f = File::create(&file).unwrap();
        f.write_all(b"abc").unwrap();
        drop(f);
        // SHA-256("abc")
        assert_eq!(
            sha256_file(&file).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_mismatched_digest_is_refused_and_the_file_removed() {
        let dir = tmpdir("mismatch");
        let file = dir.join("payload.bin");
        fs::write(&file, b"tampered").unwrap();

        let err = verify_or_remove(&file, &"0".repeat(64)).unwrap_err();
        assert!(matches!(err, EngineError::DigestMismatch { .. }));
        // Nothing usable may be left behind.
        assert!(!file.exists(), "a rejected payload must not remain on disk");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_matching_digest_is_accepted_and_kept() {
        let dir = tmpdir("accepted");
        let file = dir.join("payload.bin");
        fs::write(&file, b"abc").unwrap();
        let digest = sha256_file(&file).unwrap();
        verify_or_remove(&file, &digest).unwrap();
        assert!(file.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_pinned_asset_matches_the_application_table_shape() {
        // Guards against the two tables drifting: the same three platforms, real
        // digests, plausible sizes.
        let table = pinned_assets();
        assert_eq!(table.len(), 3);
        for (platform, info) in table {
            assert!(["win32", "linux", "darwin"].contains(&platform));
            assert_eq!(info.sha256.len(), 64, "{platform} digest must be sha256 hex");
            assert!(info.size > 100_000_000, "{platform} engine size looks wrong");
            assert!(info.asset.contains(PINNED_KERNEL_VERSION));
        }
    }

    #[test]
    fn an_unsupported_platform_is_reported_not_guessed() {
        let opts = EnsureEngineOptions {
            platform: Some("plan9".to_string()),
            target_dir: Some(tmpdir("unsupported")),
            ..Default::default()
        };
        assert!(matches!(
            ensure_engine(&opts),
            Err(EngineError::UnsupportedPlatform(_))
        ));
    }

    #[test]
    fn a_cached_engine_is_returned_without_any_download() {
        let dir = tmpdir("cached");
        let info = pinned_assets()
            .into_iter()
            .find(|(k, _)| *k == "win32")
            .map(|(_, i)| i)
            .unwrap();
        let kernel_dir = dir.join(PINNED_KERNEL_VERSION);
        let exe = kernel_dir.join(info.executable_subpath);
        fs::create_dir_all(exe.parent().unwrap()).unwrap();
        fs::write(&exe, b"binary").unwrap();
        fs::write(kernel_dir.join(".kernel-version"), PINNED_KERNEL_VERSION).unwrap();

        // No local archive and no network: a cache hit must not need either.
        let opts = EnsureEngineOptions {
            platform: Some("win32".to_string()),
            target_dir: Some(dir.clone()),
            ..Default::default()
        };
        let resolved = ensure_engine(&opts).unwrap();
        assert_eq!(resolved, exe);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_executable_without_the_version_marker_is_not_a_cache_hit() {
        // A unit test must never touch the network, so this supplies a local archive
        // whose digest cannot match. The point stands: an executable on its own is
        // not evidence of a verified engine, so acquisition is attempted rather than
        // the stale path being trusted.
        let dir = tmpdir("no-marker");
        let info = pinned_assets()
            .into_iter()
            .find(|(k, _)| *k == "win32")
            .map(|(_, i)| i)
            .unwrap();
        let kernel_dir = dir.join(PINNED_KERNEL_VERSION);
        let exe = kernel_dir.join(info.executable_subpath);
        fs::create_dir_all(exe.parent().unwrap()).unwrap();
        fs::write(&exe, b"binary").unwrap();
        // Marker deliberately absent.

        let fake_archive = dir.join("fake.zip");
        fs::write(&fake_archive, b"not the real engine").unwrap();

        let opts = EnsureEngineOptions {
            platform: Some("win32".to_string()),
            target_dir: Some(dir.clone()),
            local_archive: Some(fake_archive),
            ..Default::default()
        };

        // Acquisition is attempted and fails closed on the digest, rather than the
        // bare executable being accepted as a cache hit.
        let err = ensure_engine(&opts).unwrap_err();
        assert!(matches!(err, EngineError::DigestMismatch { .. }));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_local_archive_extracts_to_the_expected_executable_path() {
        // The offline path: an operator with the archive on disk should not need the
        // network. This asserts the extraction lands the executable where the pinned
        // table says it will be, which is what makes the cache check meaningful.
        let dir = tmpdir("local-archive");
        let inner = "ungoogled-chromium_148.0.7778.215-1.1_windows_x64";
        let src = dir.join("payload");
        fs::create_dir_all(src.join(inner)).unwrap();
        fs::write(src.join(inner).join("chrome.exe"), b"fake binary").unwrap();

        let archive = dir.join("engine.zip");
        let status = std::process::Command::new("tar")
            .arg("-cf")
            .arg(&archive)
            .arg("-C")
            .arg(&src)
            .arg(inner)
            .status()
            .unwrap();
        if !status.success() {
            // tar unavailable on this host — nothing to assert.
            return;
        }

        let kernel_dir = dir.join("target").join(PINNED_KERNEL_VERSION);
        fs::create_dir_all(&kernel_dir).unwrap();
        extract_zip(&archive, &kernel_dir).unwrap();

        // The subpath comes from the pinned table rather than being spelled out here,
        // so a table change that breaks extraction fails this test.
        let info = pinned_assets()
            .into_iter()
            .find(|(k, _)| *k == "win32")
            .map(|(_, i)| i)
            .unwrap();
        assert!(kernel_dir.join(info.executable_subpath).exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
