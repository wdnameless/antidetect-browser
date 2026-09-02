from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ApiResponse:
    code: int
    msg: str
    data: Any = None


@dataclass
class BrowserWsEndpoints:
    puppeteer: Optional[str] = None
    selenium: Optional[str] = None


@dataclass
class BrowserStartData:
    ws: Optional[BrowserWsEndpoints] = None
    pid: Optional[int] = None
    debug_port: Optional[int] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProfileItem:
    user_id: str
    name: str
    group_id: Optional[str] = None
    browser_type: Optional[str] = None
    proxy_id: Optional[str] = None
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProfileListResult:
    list: List[Dict[str, Any]] = field(default_factory=list)
    total: Optional[int] = None
    page: Optional[int] = None
    page_size: Optional[int] = None


@dataclass
class ProxyItem:
    type: str
    host: str
    port: int
    proxy_id: Optional[str] = None
    id: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    name: Optional[str] = None
    status: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProxyCheckResult:
    ok: Optional[bool] = None
    status: Optional[str] = None
    latency_ms: Optional[int] = None
    ip: Optional[str] = None
    country: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DiagnosticReport:
    profile_id: str
    timestamp: Optional[int] = None
    checks: Dict[str, Any] = field(default_factory=dict)
    extra: Dict[str, Any] = field(default_factory=dict)
