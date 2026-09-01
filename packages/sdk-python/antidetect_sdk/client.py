from typing import Any, Dict, List, Optional
import httpx

from .errors import ApiError
from .models import (
    ApiResponse,
    BrowserStartData,
    BrowserWsEndpoints,
    DiagnosticReport,
    ProfileItem,
    ProfileListResult,
    ProxyCheckResult,
    ProxyItem,
)


def _parse_response(response: httpx.Response) -> ApiResponse:
    try:
        data = response.json()
    except Exception:
        data = None

    if response.is_error:
        msg = f"HTTP error {response.status_code}: {response.reason_phrase}"
        code = -1
        if isinstance(data, dict):
            if "msg" in data and isinstance(data["msg"], str):
                msg = data["msg"]
            if "code" in data and isinstance(data["code"], int):
                code = data["code"]
        raise ApiError(msg, status_code=response.status_code, code=code, body=data)

    if isinstance(data, dict):
        code = data.get("code", 0)
        msg = data.get("msg", "success")
        res_data = data.get("data")
        if code != 0:
            raise ApiError(msg or "API returned failure code", status_code=response.status_code, code=code, body=data)
        return ApiResponse(code=code, msg=msg, data=res_data)

    return ApiResponse(code=0, msg="success", data=data)


class _SyncProfilesNamespace:
    def __init__(self, client: "AntidetectClient") -> None:
        self._c = client

    def list(
        self,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
        group_id: Optional[str] = None,
        name: Optional[str] = None,
    ) -> ApiResponse:
        params: Dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if page_size is not None:
            params["page_size"] = page_size
        if group_id is not None:
            params["group_id"] = group_id
        if name is not None:
            params["name"] = name
        return self._c.request("GET", "/api/v1/browser/list", params=params)

    def get(self, user_id: str) -> ApiResponse:
        return self._c.request("GET", "/api/v1/browser-profile/detail", params={"user_id": user_id})

    def create(
        self,
        name: str,
        group_id: Optional[str] = None,
        proxy_id: Optional[str] = None,
        browser_type: Optional[str] = None,
        os: Optional[str] = None,
        notes: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"name": name, **extra}
        if group_id is not None:
            payload["group_id"] = group_id
        if proxy_id is not None:
            payload["proxy_id"] = proxy_id
        if browser_type is not None:
            payload["browser_type"] = browser_type
        if os is not None:
            payload["os"] = os
        if notes is not None:
            payload["notes"] = notes
        return self._c.request("POST", "/api/v1/browser-profile/create", json=payload)

    def update(
        self,
        user_id: str,
        name: Optional[str] = None,
        group_id: Optional[str] = None,
        proxy_id: Optional[str] = None,
        notes: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"user_id": user_id, **extra}
        if name is not None:
            payload["name"] = name
        if group_id is not None:
            payload["group_id"] = group_id
        if proxy_id is not None:
            payload["proxy_id"] = proxy_id
        if notes is not None:
            payload["notes"] = notes
        return self._c.request("POST", "/api/v1/browser-profile/update", json=payload)

    def delete(self, user_id: str) -> ApiResponse:
        return self._c.request("POST", "/api/v1/browser-profile/delete", json={"user_id": user_id})

    def temporary(
        self,
        name: Optional[str] = None,
        browser_type: Optional[str] = None,
        proxy_id: Optional[str] = None,
        os: Optional[str] = None,
        ttl_minutes: Optional[int] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {**extra}
        if name is not None:
            payload["name"] = name
        if browser_type is not None:
            payload["browser_type"] = browser_type
        if proxy_id is not None:
            payload["proxy_id"] = proxy_id
        if os is not None:
            payload["os"] = os
        if ttl_minutes is not None:
            payload["ttl_minutes"] = ttl_minutes
        return self._c.request("POST", "/api/v1/profiles/temporary", json=payload)


class _SyncBrowserNamespace:
    def __init__(self, client: "AntidetectClient") -> None:
        self._c = client

    def start(
        self,
        user_id: str,
        headless: Optional[bool] = None,
        proxy_id: Optional[str] = None,
        url: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"user_id": user_id, **extra}
        if headless is not None:
            payload["headless"] = headless
        if proxy_id is not None:
            payload["proxy_id"] = proxy_id
        if url is not None:
            payload["url"] = url
        return self._c.request("POST", "/api/v1/browser/start", json=payload)

    def stop(self, user_id: str) -> ApiResponse:
        return self._c.request("POST", "/api/v1/browser/stop", json={"user_id": user_id})

    def list(
        self,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
        group_id: Optional[str] = None,
        name: Optional[str] = None,
    ) -> ApiResponse:
        params: Dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if page_size is not None:
            params["page_size"] = page_size
        if group_id is not None:
            params["group_id"] = group_id
        if name is not None:
            params["name"] = name
        return self._c.request("GET", "/api/v1/browser/list", params=params)


class _SyncProxyNamespace:
    def __init__(self, client: "AntidetectClient") -> None:
        self._c = client

    def list(self) -> ApiResponse:
        return self._c.request("GET", "/api/v1/proxy/list")

    def create(
        self,
        type: str,
        host: str,
        port: int,
        username: Optional[str] = None,
        password: Optional[str] = None,
        name: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"type": type, "host": host, "port": port, **extra}
        if username is not None:
            payload["username"] = username
        if password is not None:
            payload["password"] = password
        if name is not None:
            payload["name"] = name
        return self._c.request("POST", "/api/v1/proxy/create", json=payload)

    def update(
        self,
        proxy_id: str,
        type: Optional[str] = None,
        host: Optional[str] = None,
        port: Optional[int] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        name: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"proxy_id": proxy_id, **extra}
        if type is not None:
            payload["type"] = type
        if host is not None:
            payload["host"] = host
        if port is not None:
            payload["port"] = port
        if username is not None:
            payload["username"] = username
        if password is not None:
            payload["password"] = password
        if name is not None:
            payload["name"] = name
        return self._c.request("POST", "/api/v1/proxy/update", json=payload)

    def delete(self, proxy_id: str) -> ApiResponse:
        return self._c.request("POST", "/api/v1/proxy/delete", json={"proxy_id": proxy_id})

    def check(self, proxy_id: str) -> ApiResponse:
        return self._c.request("POST", "/api/v1/proxy/check", json={"proxy_id": proxy_id})

    def test(
        self,
        type: str,
        host: str,
        port: int,
        username: Optional[str] = None,
        password: Optional[str] = None,
        name: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"type": type, "host": host, "port": port, **extra}
        if username is not None:
            payload["username"] = username
        if password is not None:
            payload["password"] = password
        if name is not None:
            payload["name"] = name
        return self._c.request("POST", "/api/v1/proxy/test", json=payload)


class _SyncDiagnosticsNamespace:
    def __init__(self, client: "AntidetectClient") -> None:
        self._c = client

    def run(self, profile_id: str) -> ApiResponse:
        return self._c.request("GET", f"/api/v1/diagnostics/{profile_id}")


class _SyncAdsPowerNamespace:
    def __init__(self, client: "AntidetectClient") -> None:
        self._c = client

    def user_list(
        self,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
        group_id: Optional[str] = None,
    ) -> ApiResponse:
        params: Dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if page_size is not None:
            params["page_size"] = page_size
        if group_id is not None:
            params["group_id"] = group_id
        return self._c.request("GET", "/api/v1/user/list", params=params)

    def user_create(self, **data: Any) -> ApiResponse:
        return self._c.request("POST", "/api/v1/user/create", json=data)

    def user_update(self, user_id: str, **data: Any) -> ApiResponse:
        payload: Dict[str, Any] = {"user_id": user_id, **data}
        return self._c.request("POST", "/api/v1/user/update", json=payload)

    def user_delete(self, user_ids: List[str]) -> ApiResponse:
        return self._c.request("POST", "/api/v1/user/delete", json={"user_ids": user_ids})

    def browser_start(self, user_id: str, headless: Optional[bool] = None, **extra: Any) -> ApiResponse:
        params: Dict[str, Any] = {"user_id": user_id, **extra}
        if headless is not None:
            params["headless"] = "1" if headless else "0"
        return self._c.request("GET", "/api/v1/browser/start", params=params)

    def browser_stop(self, user_id: str) -> ApiResponse:
        return self._c.request("GET", "/api/v1/browser/stop", params={"user_id": user_id})

    def browser_active(self) -> ApiResponse:
        return self._c.request("GET", "/api/v1/browser/active")


class AntidetectClient:
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:3000",
        token: Optional[str] = None,
        timeout: float = 30.0,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        self._http = httpx.Client(
            base_url=self.base_url,
            headers=headers,
            timeout=self.timeout,
            transport=transport,
        )

        self.profiles = _SyncProfilesNamespace(self)
        self.browser = _SyncBrowserNamespace(self)
        self.proxy = _SyncProxyNamespace(self)
        self.diagnostics = _SyncDiagnosticsNamespace(self)
        self.adspower = _SyncAdsPowerNamespace(self)

    def request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Any] = None,
    ) -> ApiResponse:
        try:
            resp = self._http.request(method=method, url=path, params=params, json=json)
        except httpx.RequestError as exc:
            raise ApiError(f"Network request failed: {exc}", status_code=0, code=-1, body=None) from exc
        return _parse_response(resp)

    def get_status(self) -> ApiResponse:
        return self.request("GET", "/status")

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "AntidetectClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


# Async client implementation

class _AsyncProfilesNamespace:
    def __init__(self, client: "AsyncAntidetectClient") -> None:
        self._c = client

    async def list(
        self,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
        group_id: Optional[str] = None,
        name: Optional[str] = None,
    ) -> ApiResponse:
        params: Dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if page_size is not None:
            params["page_size"] = page_size
        if group_id is not None:
            params["group_id"] = group_id
        if name is not None:
            params["name"] = name
        return await self._c.request("GET", "/api/v1/browser/list", params=params)

    async def get(self, user_id: str) -> ApiResponse:
        return await self._c.request("GET", "/api/v1/browser-profile/detail", params={"user_id": user_id})

    async def create(
        self,
        name: str,
        group_id: Optional[str] = None,
        proxy_id: Optional[str] = None,
        browser_type: Optional[str] = None,
        os: Optional[str] = None,
        notes: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"name": name, **extra}
        if group_id is not None:
            payload["group_id"] = group_id
        if proxy_id is not None:
            payload["proxy_id"] = proxy_id
        if browser_type is not None:
            payload["browser_type"] = browser_type
        if os is not None:
            payload["os"] = os
        if notes is not None:
            payload["notes"] = notes
        return await self._c.request("POST", "/api/v1/browser-profile/create", json=payload)

    async def update(
        self,
        user_id: str,
        name: Optional[str] = None,
        group_id: Optional[str] = None,
        proxy_id: Optional[str] = None,
        notes: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"user_id": user_id, **extra}
        if name is not None:
            payload["name"] = name
        if group_id is not None:
            payload["group_id"] = group_id
        if proxy_id is not None:
            payload["proxy_id"] = proxy_id
        if notes is not None:
            payload["notes"] = notes
        return await self._c.request("POST", "/api/v1/browser-profile/update", json=payload)

    async def delete(self, user_id: str) -> ApiResponse:
        return await self._c.request("POST", "/api/v1/browser-profile/delete", json={"user_id": user_id})

    async def temporary(
        self,
        name: Optional[str] = None,
        browser_type: Optional[str] = None,
        proxy_id: Optional[str] = None,
        os: Optional[str] = None,
        ttl_minutes: Optional[int] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {**extra}
        if name is not None:
            payload["name"] = name
        if browser_type is not None:
            payload["browser_type"] = browser_type
        if proxy_id is not None:
            payload["proxy_id"] = proxy_id
        if os is not None:
            payload["os"] = os
        if ttl_minutes is not None:
            payload["ttl_minutes"] = ttl_minutes
        return await self._c.request("POST", "/api/v1/profiles/temporary", json=payload)


class _AsyncBrowserNamespace:
    def __init__(self, client: "AsyncAntidetectClient") -> None:
        self._c = client

    async def start(
        self,
        user_id: str,
        headless: Optional[bool] = None,
        proxy_id: Optional[str] = None,
        url: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"user_id": user_id, **extra}
        if headless is not None:
            payload["headless"] = headless
        if proxy_id is not None:
            payload["proxy_id"] = proxy_id
        if url is not None:
            payload["url"] = url
        return await self._c.request("POST", "/api/v1/browser/start", json=payload)

    async def stop(self, user_id: str) -> ApiResponse:
        return await self._c.request("POST", "/api/v1/browser/stop", json={"user_id": user_id})

    async def list(
        self,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
        group_id: Optional[str] = None,
        name: Optional[str] = None,
    ) -> ApiResponse:
        params: Dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if page_size is not None:
            params["page_size"] = page_size
        if group_id is not None:
            params["group_id"] = group_id
        if name is not None:
            params["name"] = name
        return await self._c.request("GET", "/api/v1/browser/list", params=params)


class _AsyncProxyNamespace:
    def __init__(self, client: "AsyncAntidetectClient") -> None:
        self._c = client

    async def list(self) -> ApiResponse:
        return await self._c.request("GET", "/api/v1/proxy/list")

    async def create(
        self,
        type: str,
        host: str,
        port: int,
        username: Optional[str] = None,
        password: Optional[str] = None,
        name: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"type": type, "host": host, "port": port, **extra}
        if username is not None:
            payload["username"] = username
        if password is not None:
            payload["password"] = password
        if name is not None:
            payload["name"] = name
        return await self._c.request("POST", "/api/v1/proxy/create", json=payload)

    async def update(
        self,
        proxy_id: str,
        type: Optional[str] = None,
        host: Optional[str] = None,
        port: Optional[int] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        name: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"proxy_id": proxy_id, **extra}
        if type is not None:
            payload["type"] = type
        if host is not None:
            payload["host"] = host
        if port is not None:
            payload["port"] = port
        if username is not None:
            payload["username"] = username
        if password is not None:
            payload["password"] = password
        if name is not None:
            payload["name"] = name
        return await self._c.request("POST", "/api/v1/proxy/update", json=payload)

    async def delete(self, proxy_id: str) -> ApiResponse:
        return await self._c.request("POST", "/api/v1/proxy/delete", json={"proxy_id": proxy_id})

    async def check(self, proxy_id: str) -> ApiResponse:
        return await self._c.request("POST", "/api/v1/proxy/check", json={"proxy_id": proxy_id})

    async def test(
        self,
        type: str,
        host: str,
        port: int,
        username: Optional[str] = None,
        password: Optional[str] = None,
        name: Optional[str] = None,
        **extra: Any,
    ) -> ApiResponse:
        payload: Dict[str, Any] = {"type": type, "host": host, "port": port, **extra}
        if username is not None:
            payload["username"] = username
        if password is not None:
            payload["password"] = password
        if name is not None:
            payload["name"] = name
        return await self._c.request("POST", "/api/v1/proxy/test", json=payload)


class _AsyncDiagnosticsNamespace:
    def __init__(self, client: "AsyncAntidetectClient") -> None:
        self._c = client

    async def run(self, profile_id: str) -> ApiResponse:
        return await self._c.request("GET", f"/api/v1/diagnostics/{profile_id}")


class _AsyncAdsPowerNamespace:
    def __init__(self, client: "AsyncAntidetectClient") -> None:
        self._c = client

    async def user_list(
        self,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
        group_id: Optional[str] = None,
    ) -> ApiResponse:
        params: Dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if page_size is not None:
            params["page_size"] = page_size
        if group_id is not None:
            params["group_id"] = group_id
        return await self._c.request("GET", "/api/v1/user/list", params=params)

    async def user_create(self, **data: Any) -> ApiResponse:
        return await self._c.request("POST", "/api/v1/user/create", json=data)

    async def user_update(self, user_id: str, **data: Any) -> ApiResponse:
        payload: Dict[str, Any] = {"user_id": user_id, **data}
        return await self._c.request("POST", "/api/v1/user/update", json=payload)

    async def user_delete(self, user_ids: List[str]) -> ApiResponse:
        return await self._c.request("POST", "/api/v1/user/delete", json={"user_ids": user_ids})

    async def browser_start(self, user_id: str, headless: Optional[bool] = None, **extra: Any) -> ApiResponse:
        params: Dict[str, Any] = {"user_id": user_id, **extra}
        if headless is not None:
            params["headless"] = "1" if headless else "0"
        return await self._c.request("GET", "/api/v1/browser/start", params=params)

    async def browser_stop(self, user_id: str) -> ApiResponse:
        return await self._c.request("GET", "/api/v1/browser/stop", params={"user_id": user_id})

    async def browser_active(self) -> ApiResponse:
        return await self._c.request("GET", "/api/v1/browser/active")


class AsyncAntidetectClient:
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:3000",
        token: Optional[str] = None,
        timeout: float = 30.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=self.timeout,
            transport=transport,
        )

        self.profiles = _AsyncProfilesNamespace(self)
        self.browser = _AsyncBrowserNamespace(self)
        self.proxy = _AsyncProxyNamespace(self)
        self.diagnostics = _AsyncDiagnosticsNamespace(self)
        self.adspower = _AsyncAdsPowerNamespace(self)

    async def request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Any] = None,
    ) -> ApiResponse:
        try:
            resp = await self._http.request(method=method, url=path, params=params, json=json)
        except httpx.RequestError as exc:
            raise ApiError(f"Network request failed: {exc}", status_code=0, code=-1, body=None) from exc
        return _parse_response(resp)

    async def get_status(self) -> ApiResponse:
        return await self.request("GET", "/status")

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "AsyncAntidetectClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()
