import os
import shutil
import tempfile
import zipfile
import pytest
from antidetect_sdk import (
    AntidetectClient,
    AsyncAntidetectClient,
    ensure_engine,
    ensureEngine,
    launch_standalone_profile,
    launchStandaloneProfile,
    build_standalone_args,
    buildStandaloneArgs,
    StandaloneLaunchConfig,
    StandaloneFingerprintConfig,
    StandaloneProfileInstance,
)
from antidetect_sdk.engine import PINNED_KERNEL_VERSION, PINNED_KERNEL_ASSETS


def test_public_surface_parity():
    # Standalone module functions exist in both snake_case and camelCase
    assert callable(ensure_engine)
    assert callable(ensureEngine)
    assert callable(launch_standalone_profile)
    assert callable(launchStandaloneProfile)
    assert callable(build_standalone_args)
    assert callable(buildStandaloneArgs)

    # Client methods exist in both snake_case and camelCase
    client = AntidetectClient(base_url="http://localhost:9999")
    assert hasattr(client, "ensure_engine")
    assert hasattr(client, "ensureEngine")
    assert hasattr(client, "launch_standalone_profile")
    assert hasattr(client, "launchStandaloneProfile")
    assert hasattr(client, "build_standalone_args")
    assert hasattr(client, "buildStandaloneArgs")

    async_client = AsyncAntidetectClient(base_url="http://localhost:9999")
    assert hasattr(async_client, "ensure_engine")
    assert hasattr(async_client, "ensureEngine")
    assert hasattr(async_client, "launch_standalone_profile")
    assert hasattr(async_client, "launchStandaloneProfile")
    assert hasattr(async_client, "build_standalone_args")
    assert hasattr(async_client, "buildStandaloneArgs")


def test_build_standalone_args():
    cfg = StandaloneLaunchConfig(
        user_data_dir="D:/tmp/test_dir",
        port=9222,
        proxy_server="http://proxy.example.com:8080",
        fingerprint=StandaloneFingerprintConfig(
            seed=4242,
            platform="windows",
            lang="en-US",
        ),
        args=["--custom-flag=true"],
    )
    args = build_standalone_args(cfg)

    assert any(a.startswith("--user-data-dir=") for a in args)
    assert "--remote-debugging-port=9222" in args
    assert "--proxy-server=http://proxy.example.com:8080" in args
    assert any(a.startswith("--fingerprint-seed=") for a in args)
    assert "--fingerprint-platform=windows" in args
    assert "--lang=en-US" in args
    assert "--custom-flag=true" in args


def test_engine_wrong_digest_refusal():
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create a fake zip
        fake_zip = os.path.join(tmpdir, "fake.zip")
        with zipfile.ZipFile(fake_zip, "w") as z:
            z.writestr("test.txt", "hello")

        # A digest that cannot match must be refused, and refused as an engine
        # acquisition error rather than a generic failure.
        #
        # The URL comes from Path.as_uri(), not an f-string: on Windows a raw path has
        # backslashes, and `file://C:\...` is not a valid URL — urllib rejects it before
        # the digest is ever checked, so the test would fail for the wrong reason.
        from pathlib import Path

        from antidetect_sdk.engine import EngineAcquireError, KernelAssetInfo

        wrong = KernelAssetInfo(
            asset="fake.zip",
            sha256="0" * 64,
            size=None,
            executable_subpath="chrome.exe",
            archive_type="zip",
        )
        with pytest.raises(EngineAcquireError) as excinfo:
            ensure_engine(
                download_url=Path(fake_zip).as_uri(),
                target_dir=tmpdir,
                expected_digests={"win32": wrong, "linux": wrong, "darwin": wrong},
                platform="win32",
            )
        assert "mismatch" in str(excinfo.value).lower()


def test_engine_cached_acquisition():
    with tempfile.TemporaryDirectory() as tmpdir:
        # The cache fast-path requires the executable AND a version marker — the
        # marker is what proves the cached build is the pinned one rather than a
        # stale engine of an older version.
        expected = PINNED_KERNEL_ASSETS["win32"]
        kernel_dir = tmpdir
        exe_path = os.path.join(kernel_dir, expected.executable_subpath)
        os.makedirs(os.path.dirname(exe_path), exist_ok=True)
        with open(exe_path, "w", encoding="utf-8") as f:
            f.write("binary")
        with open(os.path.join(kernel_dir, ".kernel-version"), "w", encoding="utf-8") as f:
            f.write(PINNED_KERNEL_VERSION)

        def exploding_fetch(_url: str) -> bytes:
            raise AssertionError("cached engine must not trigger a download")

        res = ensure_engine(
            platform="win32",
            target_dir=tmpdir,
            fetch_fn=exploding_fetch,
        )
        assert os.path.abspath(res["executable"]) == os.path.abspath(exe_path)
        assert os.path.abspath(res["kernelDir"]) == os.path.abspath(kernel_dir)


def test_engine_cache_misses_without_version_marker():
    """An executable alone is not a cache hit: the marker is what pins the version."""
    with tempfile.TemporaryDirectory() as tmpdir:
        expected = PINNED_KERNEL_ASSETS["win32"]
        exe_path = os.path.join(tmpdir, expected.executable_subpath)
        os.makedirs(os.path.dirname(exe_path), exist_ok=True)
        with open(exe_path, "w", encoding="utf-8") as f:
            f.write("binary")

        calls = []

        def failing_fetch(url: str) -> bytes:
            calls.append(url)
            raise RuntimeError("stopped before download completed")

        from antidetect_sdk.engine import EngineAcquireError

        with pytest.raises((EngineAcquireError, RuntimeError)):
            ensure_engine(platform="win32", target_dir=tmpdir, fetch_fn=failing_fetch)
        # It must have TRIED to download rather than trusting the bare executable.
        assert calls, "a missing version marker must not be treated as a cache hit"
