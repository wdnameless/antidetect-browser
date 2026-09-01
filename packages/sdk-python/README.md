# antidetect-sdk (Python)

Python SDK with sync and async clients (powered by `httpx`) for controlling the Antidetect Browser local REST API.

## Installation

```bash
pip install antidetect-sdk
```

## Quickstart

### Sync Client

```python
from antidetect_sdk import AntidetectClient, ApiError
from playwright.sync_api import sync_playwright

client = AntidetectClient(base_url="http://127.0.0.1:3000", token="YOUR_API_TOKEN")

# 1. Server status
status = client.get_status()
print("Status:", status)

# 2. Ephemeral / temporary profile
temp = client.profiles.temporary(name="Quick Py Task", ttl_minutes=30)
user_id = temp.data["user_id"]
print(f"Created temporary profile: {user_id}")

# 3. Launch browser
res = client.browser.start(user_id=user_id)
ws_endpoint = res.data.get("ws", {}).get("puppeteer")

# 4. Connect Playwright CDP
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(ws_endpoint)
    page = browser.new_page()
    page.goto("https://example.com")
    print("Title:", page.title())
    browser.close()

# 5. Stop profile
client.browser.stop(user_id=user_id)
```

### Async Client

```python
import asyncio
from antidetect_sdk import AsyncAntidetectClient, ApiError
from playwright.async_api import async_playwright

async def main():
    async with AsyncAntidetectClient(base_url="http://127.0.0.1:3000") as client:
        # Create temporary profile
        temp = await client.profiles.temporary(name="Async Task")
        user_id = temp.data["user_id"]
        
        # Start browser
        start_res = await client.browser.start(user_id=user_id)
        ws_endpoint = start_res.data["ws"]["puppeteer"]
        
        async with async_playwright() as p:
            browser = await p.chromium.connect_over_cdp(ws_endpoint)
            page = await browser.new_page()
            await page.goto("https://example.com")
            print("Async page title:", await page.title())
            await browser.close()
            
        await client.browser.stop(user_id=user_id)

asyncio.run(main())
```

## Namespaces

- `client.profiles`: `list`, `get`, `create`, `update`, `delete`, `temporary`
- `client.browser`: `start`, `stop`, `list`
- `client.proxy`: `list`, `create`, `update`, `delete`, `check`, `test`
- `client.diagnostics`: `run`
- `client.adspower`: `user_list`, `user_create`, `user_update`, `user_delete`, `browser_start`, `browser_stop`, `browser_active`
