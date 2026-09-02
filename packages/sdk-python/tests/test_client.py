import json
import httpx
import pytest
from antidetect_sdk import AntidetectClient, AsyncAntidetectClient, ApiError


def test_sync_client_and_namespaces():
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        method = request.method

        # Check auth header
        if request.headers.get("Authorization") == "Bearer secret-token":
            pass
        elif "unauthorized" in url:
            return httpx.Response(401, json={"code": 401, "msg": "Unauthorized", "data": None})

        if url.endswith("/status"):
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"version": "1.0.0"}})

        if "/api/v1/browser/list" in url:
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"list": [{"user_id": "u1", "name": "p1"}]}})

        if "/api/v1/browser-profile/detail" in url:
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"user_id": "u1", "name": "p1"}})

        if "/api/v1/browser-profile/create" in url and method == "POST":
            body = json.loads(request.content)
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"user_id": "u2", "name": body["name"]}})

        if "/api/v1/browser-profile/update" in url and method == "POST":
            body = json.loads(request.content)
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"user_id": body["user_id"], "name": "updated"}})

        if "/api/v1/browser-profile/delete" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "deleted", "data": {}})

        if "/api/v1/profiles/temporary" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"user_id": "temp_1", "name": "temp"}})

        if "/api/v1/browser/start" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"ws": {"puppeteer": "ws://127.0.0.1:9222/ws"}}})

        if "/api/v1/browser/stop" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "stopped", "data": {}})

        if "/api/v1/proxy/list" in url and method == "GET":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"list": []}})

        if "/api/v1/proxy/create" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"proxy_id": "px1"}})

        if "/api/v1/proxy/update" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"proxy_id": "px1"}})

        if "/api/v1/proxy/delete" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {}})

        if "/api/v1/proxy/check" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"ok": True, "ip": "1.1.1.1"}})

        if "/api/v1/proxy/test" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"ok": True}})

        if "/api/v1/diagnostics/u1" in url and method == "GET":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"profileId": "u1", "checks": {}}})

        # AdsPower endpoints
        if "/api/v1/user/list" in url and method == "GET":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"list": []}})

        if "/api/v1/user/create" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"id": "ad1"}})

        if "/api/v1/user/update" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {}})

        if "/api/v1/user/delete" in url and method == "POST":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {}})

        if "/api/v1/browser/start" in url and method == "GET":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"ws": {"puppeteer": "ws://127.0.0.1:9222/ws"}}})

        if "/api/v1/browser/stop" in url and method == "GET":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {}})

        if "/api/v1/browser/active" in url and method == "GET":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"status": "Active"}})

        return httpx.Response(404, json={"code": 404, "msg": "not found", "data": None})

    transport = httpx.MockTransport(handler)
    client = AntidetectClient(base_url="http://testserver", token="secret-token", transport=transport)

    with client:
        # Status
        res = client.get_status()
        assert res.code == 0
        assert res.data["version"] == "1.0.0"

        # Profiles
        p_list = client.profiles.list()
        assert len(p_list.data["list"]) == 1
        p_detail = client.profiles.get("u1")
        assert p_detail.data["name"] == "p1"
        p_create = client.profiles.create(name="new_profile")
        assert p_create.data["user_id"] == "u2"
        p_update = client.profiles.update(user_id="u2", name="renamed")
        assert p_update.data["user_id"] == "u2"
        p_delete = client.profiles.delete("u2")
        assert p_delete.code == 0
        p_temp = client.profiles.temporary(name="temp", ttl_minutes=15)
        assert p_temp.data["user_id"] == "temp_1"

        # Browser
        b_start = client.browser.start("u1", headless=True)
        assert "ws" in b_start.data
        b_stop = client.browser.stop("u1")
        assert b_stop.code == 0
        b_list = client.browser.list()
        assert len(b_list.data["list"]) == 1

        # Proxy
        px_list = client.proxy.list()
        assert "list" in px_list.data
        px_create = client.proxy.create(type="http", host="1.2.3.4", port=8080)
        assert px_create.data["proxy_id"] == "px1"
        px_update = client.proxy.update(proxy_id="px1", port=8081)
        assert px_update.data["proxy_id"] == "px1"
        px_del = client.proxy.delete("px1")
        assert px_del.code == 0
        px_chk = client.proxy.check("px1")
        assert px_chk.data["ok"] is True
        px_test = client.proxy.test(type="socks5", host="1.2.3.4", port=1080)
        assert px_test.data["ok"] is True

        # Diagnostics
        diag = client.diagnostics.run("u1")
        assert diag.data["profileId"] == "u1"

        # AdsPower
        assert client.adspower.user_list().code == 0
        assert client.adspower.user_create(name="ad1").data["id"] == "ad1"
        assert client.adspower.user_update(user_id="ad1", name="ad2").code == 0
        assert client.adspower.user_delete(["ad1"]).code == 0
        assert client.adspower.browser_start(user_id="u1", headless=False).code == 0
        assert client.adspower.browser_stop(user_id="u1").code == 0
        assert client.adspower.browser_active().code == 0


def test_sync_error_handling():
    def err_handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "401" in url:
            return httpx.Response(401, json={"code": 401, "msg": "Unauthorized"})
        if "fail_code" in url:
            return httpx.Response(200, json={"code": -1, "msg": "Validation failed", "data": None})
        return httpx.Response(500, json={"code": 500, "msg": "Internal error"})

    client = AntidetectClient(base_url="http://testserver", transport=httpx.MockTransport(err_handler))

    with pytest.raises(ApiError) as exc_info:
        client.request("GET", "/401")
    assert exc_info.value.status_code == 401
    assert exc_info.value.code == 401

    with pytest.raises(ApiError) as exc_info2:
        client.request("GET", "/fail_code")
    assert exc_info2.value.code == -1
    assert "Validation failed" in exc_info2.value.message


@pytest.mark.asyncio
async def test_async_client():
    def async_handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/status"):
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"status": "ready"}})
        if "/api/v1/profiles/temporary" in url:
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"user_id": "temp_async"}})
        if "/api/v1/browser/start" in url:
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"ws": {"puppeteer": "ws://async"}}})
        return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {}})

    transport = httpx.MockTransport(async_handler)
    async with AsyncAntidetectClient(base_url="http://testserver", token="tok", transport=transport) as client:
        st = await client.get_status()
        assert st.data["status"] == "ready"

        temp = await client.profiles.temporary(name="async")
        assert temp.data["user_id"] == "temp_async"

        b_start = await client.browser.start("temp_async")
        assert b_start.data["ws"]["puppeteer"] == "ws://async"
