# @antidetect/sdk (Node / TypeScript)

TypeScript and JavaScript SDK with zero runtime dependencies (uses native `fetch`) for controlling the Antidetect Browser local REST API.

## Installation

```bash
npm install @antidetect/sdk
```

## Quickstart

```typescript
import { AntidetectClient, ApiError } from '@antidetect/sdk';
import puppeteer from 'puppeteer-core';

const client = new AntidetectClient({
  baseUrl: 'http://127.0.0.1:3000',
  token: 'YOUR_API_TOKEN', // optional if API auth is disabled
});

async function main() {
  // 1. Health check
  const status = await client.getStatus();
  console.log('Server status:', status);

  // 2. Create an ephemeral/temporary profile
  const temp = await client.profiles.temporary({
    name: 'Quick Task',
    browser_type: 'chrome',
    ttl_minutes: 30,
  });
  console.log('Created profile:', temp.data.user_id);

  // 3. Launch browser
  const launch = await client.browser.start(temp.data.user_id, {
    headless: false,
  });

  const wsEndpoint = launch.data.ws?.puppeteer;
  if (wsEndpoint) {
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
    });
    const page = await browser.newPage();
    await page.goto('https://example.com');
    console.log('Page title:', await page.title());
    await browser.disconnect();
  }

  // 4. Stop browser session
  await client.browser.stop(temp.data.user_id);
}

main().catch((err) => {
  if (err instanceof ApiError) {
    console.error(`API Error (${err.status}):`, err.message, err.body);
  } else {
    console.error(err);
  }
});
```

## Namespaces

- `client.profiles` - Manage browser profiles (`list`, `get`, `create`, `update`, `delete`, `temporary`)
- `client.browser` - Control browser instances (`start`, `stop`, `list`)
- `client.proxy` - Manage proxies (`list`, `create`, `update`, `delete`, `check`, `test`)
- `client.diagnostics` - Profile diagnostics (`run`)
- `client.adspower` - AdsPower compatibility endpoints (`userList`, `userCreate`, `userUpdate`, `userDelete`, `browserStart`, `browserStop`, `browserActive`)
