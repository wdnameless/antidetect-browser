"""Standalone profile launching and DevToolsActivePort detection."""

from __future__ import annotations

import os
import random
import socket
import string
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .engine import ensure_engine


@dataclass
class StandaloneFingerprintConfig:
    seed: Optional[int] = None
    platform: Optional[str] = None
    platform_version: Optional[str] = None
    brand: Optional[str] = None
    brand_version: Optional[str] = None
    hardware_concurrency: Optional[int] = None
    disable_spoofing: bool = False
    timezone: Optional[str] = None
    lang: Optional[str] = None


@dataclass
class StandaloneLaunchConfig:
    executable_path: Optional[str] = None
    user_data_dir: Optional[str] = None
    port: Optional[int] = None
    headless: bool = False
    args: List[str] = field(default_factory=list)
    fingerprint: Optional[StandaloneFingerprintConfig] = None
    proxy_server: Optional[str] = None
    screen_override: Optional[Dict[str, int]] = None
    engine_options: Optional[Dict[str, Any]] = None


@dataclass
class StandaloneProfileInstance:
    cdp_url: str
    ws_endpoint: str
    port: int
    user_data_dir: str
    pid: Optional[int] = None
    process: Optional[subprocess.Popen] = None

    # camelCase properties to mirror Node SDK properties
    @property
    def cdpUrl(self) -> str:
        return self.cdp_url

    @property
    def wsEndpoint(self) -> str:
        return self.ws_endpoint

    @property
    def userDataDir(self) -> str:
        return self.user_data_dir

    def stop(self) -> None:
        """Stop the launched Chromium instance."""
        if not self.process:
            return
        if self.process.poll() is not None:
            return

        try:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        except Exception:
            pass


def build_standalone_args(config: StandaloneLaunchConfig) -> List[str]:
    """Build chromium command line arguments matching Node SDK and antidetect-browser flags."""
    flags: List[str] = []

    remote_port = config.port if config.port is not None else 0
    flags.append(f"--remote-debugging-port={remote_port}")

    if config.user_data_dir:
        flags.append(f"--user-data-dir={config.user_data_dir}")

    if config.headless:
        flags.append("--headless=new")

    flags.extend([
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-component-update",
        "--disable-background-networking",
        "--disable-features=Translate,OptimizationHints,MediaRouter",
        "--disable-client-side-phishing-detection",
        "--disable-default-apps",
        "--disable-popup-blocking",
        "--disable-prompt-on-repost",
        "--disable-sync",
        "--disable-blink-features=AutomationControlled",
        "--password-store=basic",
    ])

    if config.screen_override:
        w = config.screen_override.get("width", 1280)
        h = config.screen_override.get("height", 800)
        flags.append(f"--window-size={w},{h}")

    if config.proxy_server:
        flags.append(f"--proxy-server={config.proxy_server}")

    fp = config.fingerprint
    if fp:
        if fp.disable_spoofing:
            flags.append("--disable-antidetect-spoofing")
        if fp.seed is not None:
            flags.append(f"--fingerprint-seed={fp.seed}")
        if fp.platform:
            flags.append(f"--fingerprint-platform={fp.platform}")
        if fp.platform_version:
            flags.append(f"--fingerprint-platform-version={fp.platform_version}")
        if fp.brand:
            flags.append(f"--fingerprint-brand={fp.brand}")
        if fp.brand_version:
            flags.append(f"--fingerprint-brand-version={fp.brand_version}")
        if fp.hardware_concurrency is not None:
            flags.append(f"--fingerprint-hardware-concurrency={fp.hardware_concurrency}")
        if fp.timezone:
            flags.append(f"--timezone={fp.timezone}")
        if fp.lang:
            flags.append(f"--lang={fp.lang}")

    if config.args:
        flags.extend(config.args)

    return flags


def _check_port_reachable(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        s.close()
        return True
    except Exception:
        return False


def wait_for_dev_tools_active_port(
    user_data_dir: str, timeout_ms: int = 30000
) -> Dict[str, Any]:
    """Wait for DevToolsActivePort file to appear and verify TCP connectivity."""
    active_port_path = os.path.join(user_data_dir, "DevToolsActivePort")
    deadline = time.time() + (timeout_ms / 1000.0)

    while time.time() < deadline:
        if os.path.exists(active_port_path):
            try:
                with open(active_port_path, "r", encoding="utf-8") as f:
                    lines = [line.strip() for line in f.readlines() if line.strip()]
                if len(lines) >= 2:
                    port = int(lines[0])
                    ws_path = lines[1]
                    if not ws_path.startswith("/"):
                        ws_path = f"/{ws_path}"
                    if _check_port_reachable(port):
                        return {"port": port, "wsPath": ws_path}
            except Exception:
                pass
        time.sleep(0.1)

    raise TimeoutError(
        f"Timeout waiting for DevToolsActivePort in {user_data_dir} after {timeout_ms}ms"
    )


def _generate_random_profile_dir() -> str:
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    base = os.environ.get("ANTIDETECT_DATA_DIR")
    if base:
        profiles_dir = os.path.join(base, "profiles")
    else:
        profiles_dir = os.path.join(tempfile.gettempdir(), "antidetect-standalone-profiles")
    dir_path = os.path.join(profiles_dir, f"profile-{rand}")
    os.makedirs(dir_path, exist_ok=True)
    return dir_path


def launch_standalone_profile(
    config: Optional[StandaloneLaunchConfig] = None,
    **kwargs: Any,
) -> StandaloneProfileInstance:
    """Launch a standalone Chromium profile and return its CDP endpoint."""
    if config is None:
        # Build config from kwargs if passed as dict/kwargs
        cfg = StandaloneLaunchConfig(**kwargs) if kwargs else StandaloneLaunchConfig()
    else:
        cfg = config

    executable = cfg.executable_path
    if not executable:
        engine_opts = cfg.engine_options or {}
        acquired = ensure_engine(**engine_opts)
        executable = acquired["executable"]

    if not os.path.exists(executable):

        raise FileNotFoundError(f'Chromium executable not found at "{executable}"')

    user_data_dir = cfg.user_data_dir or _generate_random_profile_dir()
    os.makedirs(user_data_dir, exist_ok=True)

    cfg.executable_path = executable
    cfg.user_data_dir = user_data_dir

    args = build_standalone_args(cfg)

    # Launch subprocess
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0x08000000

    proc = subprocess.Popen(
        [executable] + args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
    )

    try:
        active_port_info = wait_for_dev_tools_active_port(user_data_dir)
        port = active_port_info["port"]
        ws_path = active_port_info["wsPath"]
        cdp_url = f"http://127.0.0.1:{port}"
        ws_endpoint = f"ws://127.0.0.1:{port}{ws_path}"

        return StandaloneProfileInstance(
            cdp_url=cdp_url,
            ws_endpoint=ws_endpoint,
            port=port,
            user_data_dir=user_data_dir,
            pid=proc.pid,
            process=proc,
        )
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
        raise

buildStandaloneArgs = build_standalone_args
launchStandaloneProfile = launch_standalone_profile
