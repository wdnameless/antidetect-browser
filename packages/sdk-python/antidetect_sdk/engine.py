"""Engine acquisition, verification, and caching for antidetect browser SDK."""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple

PINNED_KERNEL_VERSION = "148.0.7778.215"
# MIRROR of `src/main/util/kernelAcquire.ts`. The SDK is a published package and
# cannot import from the application's source tree, so these are duplicated on
# purpose — and a test asserts both sides agree, so they cannot drift. They are
# EXTERNAL and must be re-pinned together when the upstream version changes.
KERNEL_REPO = "adryfish/fingerprint-chromium"
KERNEL_RELEASE_TAG = PINNED_KERNEL_VERSION
KERNEL_DOWNLOAD_BASE = (
    f"https://github.com/{KERNEL_REPO}/releases/download/{KERNEL_RELEASE_TAG}"
)


@dataclass(frozen=True)
class KernelAssetInfo:
    asset: str
    sha256: str
    size: Optional[int]
    executable_subpath: str
    archive_type: str


PINNED_KERNEL_ASSETS: Dict[str, KernelAssetInfo] = {
    "win32": KernelAssetInfo(
        asset=f"ungoogled-chromium_{PINNED_KERNEL_VERSION}-1.1_windows_x64.zip",
        sha256="9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579",
        size=189767686,
        executable_subpath=os.path.join(
            f"ungoogled-chromium_{PINNED_KERNEL_VERSION}-1.1_windows_x64", "chrome.exe"
        ),
        archive_type="zip",
    ),
    "linux": KernelAssetInfo(
        asset=f"ungoogled-chromium-{PINNED_KERNEL_VERSION}-1-x86_64.AppImage",
        sha256="a5fa5e6c05cb7fa3617ec2ca642ad3cc6e586ac5249cc29edb0a602d695685f0",
        size=188811768,
        executable_subpath=f"ungoogled-chromium-{PINNED_KERNEL_VERSION}-1-x86_64.AppImage",
        archive_type="appimage",
    ),
    "darwin": KernelAssetInfo(
        asset=f"ungoogled-chromium_{PINNED_KERNEL_VERSION}-1.1_macos.dmg",
        sha256="b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679",
        size=140187500,
        executable_subpath=os.path.join(
            "Chromium.app", "Contents", "MacOS", "Chromium"
        ),
        archive_type="dmg",
    ),
}


class EngineAcquireError(Exception):
    """Raised when engine download or verification fails."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


def get_default_engine_dir() -> str:
    """Returns the default directory where engines are cached."""
    env_dir = os.environ.get("ANTIDETECT_DATA_DIR")
    if env_dir:
        return os.path.join(env_dir, "chromium", PINNED_KERNEL_VERSION)

    home = Path.home()
    if sys.platform == "win32":
        app_data = os.environ.get("APPDATA") or os.path.join(home, "AppData", "Roaming")
        return os.path.join(app_data, "antidetect-browser", "chromium", PINNED_KERNEL_VERSION)
    elif sys.platform == "darwin":
        return os.path.join(
            home,
            "Library",
            "Application Support",
            "antidetect-browser",
            "chromium",
            PINNED_KERNEL_VERSION,
        )
    else:
        xdg_data = os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share")
        return os.path.join(xdg_data, "antidetect-browser", "chromium", PINNED_KERNEL_VERSION)


def ensure_engine(
    *,
    platform: Optional[str] = None,
    target_dir: Optional[str] = None,
    targetDir: Optional[str] = None,
    expected_digests: Optional[Dict[str, KernelAssetInfo]] = None,
    expectedDigests: Optional[Dict[str, KernelAssetInfo]] = None,
    fetch_fn: Optional[Callable[[str], bytes]] = None,
    fetchFn: Optional[Callable[[str], bytes]] = None,
    on_progress: Optional[Callable[[Dict[str, int]], None]] = None,
    onProgress: Optional[Callable[[Dict[str, int]], None]] = None,
    force: bool = False,
    download_url: Optional[str] = None,
    cache_dir: Optional[str] = None,
    sha256: Optional[str] = None,
    **kwargs: Any,
) -> Dict[str, str]:
    """
    Ensure platform-correct patched Chromium engine binary is present and verified.
    Idempotent: caches downloaded and verified engine, subsequent calls return immediately.
    """
    plat = platform or ("win32" if sys.platform == "win32" else ("darwin" if sys.platform == "darwin" else "linux"))
    digests = expected_digests or expectedDigests or PINNED_KERNEL_ASSETS
    asset_info = digests.get(plat)

    if not asset_info and not download_url:
        raise EngineAcquireError(f"Unsupported platform: {plat}", "UNSUPPORTED_PLATFORM")

    if download_url and not asset_info:
        asset_name = os.path.basename(download_url.split("?")[0]) or "engine.zip"
        asset_info = KernelAssetInfo(
            asset=asset_name,
            sha256=sha256 or "",
            size=None,
            executable_subpath="chrome.exe" if sys.platform == "win32" else "chrome",
            archive_type="zip",
        )
    elif sha256 and asset_info:
        asset_info = KernelAssetInfo(
            asset=asset_info.asset,
            sha256=sha256,
            size=asset_info.size,
            executable_subpath=asset_info.executable_subpath,
            archive_type=asset_info.archive_type,
        )

    kernel_dir = target_dir or targetDir or cache_dir or get_default_engine_dir()
    executable_path = os.path.join(kernel_dir, asset_info.executable_subpath)
    version_file = os.path.join(kernel_dir, ".kernel-version")
    alt_version_file = os.path.join(kernel_dir, "version.txt")

    # Cache hit check
    has_version = os.path.exists(version_file) or os.path.exists(alt_version_file)
    if not force and os.path.exists(executable_path) and has_version:
        v_file = version_file if os.path.exists(version_file) else alt_version_file
        try:
            with open(v_file, "r", encoding="utf-8") as f:
                saved = f.read().strip()
            if PINNED_KERNEL_VERSION in saved:
                return {
                    "executable": os.path.abspath(executable_path),
                    "kernelDir": os.path.abspath(kernel_dir),
                }
        except Exception:
            pass

    os.makedirs(kernel_dir, exist_ok=True)
    dl_url = download_url or f"{KERNEL_DOWNLOAD_BASE}/{asset_info.asset}"

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_download_path = os.path.join(tmp_dir, asset_info.asset)

        hasher = hashlib.sha256()

        if fetch_fn:
            data = fetch_fn(download_url)
            hasher.update(data)
            with open(tmp_download_path, "wb") as f:
                f.write(data)
            if on_progress:
                on_progress({"received": len(data), "total": len(data)})
        else:
            req = urllib.request.Request(
                download_url,
                headers={"User-Agent": f"antidetect-sdk-python/{PINNED_KERNEL_VERSION}"},
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    total_len = int(resp.headers.get("content-length", 0)) or asset_info.size or 0
                    received = 0
                    with open(tmp_download_path, "wb") as f:
                        while True:
                            chunk = resp.read(64 * 1024)
                            if not chunk:
                                break
                            hasher.update(chunk)
                            f.write(chunk)
                            received += len(chunk)
                            if on_progress:
                                on_progress({"received": received, "total": total_len})
            except Exception as e:
                raise EngineAcquireError(
                    f"Failed to download kernel asset from {download_url}: {e}",
                    "DOWNLOAD_FAILED",
                ) from e

        actual_sha256 = hasher.hexdigest()
        if actual_sha256.lower() != asset_info.sha256.lower():
            raise EngineAcquireError(
                f"SHA256 mismatch for {asset_info.asset}: expected {asset_info.sha256}, got {actual_sha256}",
                "CHECKSUM_MISMATCH",
            )

        # Extraction
        if asset_info.archive_type == "zip":
            try:
                with zipfile.ZipFile(tmp_download_path, "r") as zf:
                    zf.extractall(kernel_dir)
            except Exception as e:
                raise EngineAcquireError(
                    f"Failed to extract zip archive: {e}",
                    "EXTRACT_FAILED",
                ) from e
        elif asset_info.archive_type == "appimage":
            shutil.copy2(tmp_download_path, executable_path)
            try:
                os.chmod(executable_path, 0o755)
            except Exception:
                pass
        elif asset_info.archive_type == "dmg":
            # For dmg on non-darwin or test environments, or darwin
            # If it's darwin, hdiutil mount
            if sys.platform == "darwin":
                mount_point = os.path.join(tmp_dir, "mount")
                os.makedirs(mount_point, exist_ok=True)
                res = os.system(f'hdiutil attach -nobrowse -mountpoint "{mount_point}" "{tmp_download_path}"')
                if res != 0:
                    raise EngineAcquireError("Failed to mount DMG file", "EXTRACT_FAILED")
                try:
                    app_src = os.path.join(mount_point, "Antidetect Chromium.app")
                    app_dst = os.path.join(kernel_dir, "Antidetect Chromium.app")
                    if os.path.exists(app_dst):
                        shutil.rmtree(app_dst, ignore_errors=True)
                    shutil.copytree(app_src, app_dst)
                finally:
                    os.system(f'hdiutil detach "{mount_point}" -quiet')
            else:
                shutil.copy2(tmp_download_path, executable_path)

        # Write version cache file
        with open(version_file, "w", encoding="utf-8") as f:
            f.write(f"{PINNED_KERNEL_VERSION}:{asset_info.sha256}\n")

    return {
        "executable": os.path.abspath(executable_path),
        "kernelDir": os.path.abspath(kernel_dir),
    }

ensureEngine = ensure_engine
