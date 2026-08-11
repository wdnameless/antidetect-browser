# Local API — контракт (AdsPower-совместимый)

## База и авторизация
- Base URL: `http://localhost:50325` (порт настраивается, по умолчанию 50325).
- Слушает только loopback.
- Auth: заголовок `Authorization: Bearer <API_KEY>` на всех эндпоинтах (кроме `/status`).
- Формат ответа: `{ "code": number, "msg": string, "data": object }`. `code === 0` = успех, иначе ошибка.

## Эндпоинты

### `GET /status`
Проверка живости сервиса. Без auth.
```json
{ "code": 0, "msg": "success", "data": { "status": "ok", "version": "0.0.1" } }
```

### `GET /api/v1/browser/start?user_id=<profileId>`
Запускает профиль и возвращает CDP-эндпоинты. (AdsPower V1; также поддерживаем `POST /api/v2/browser-profile/start` с `{ profile_id }`.)

Успех:
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "ws": {
      "selenium": "127.0.0.1:52341",
      "puppeteer": "ws://127.0.0.1:52341/devtools/browser/8f6e2b1a-...."
    },
    "debug_port": "52341",
    "webdriver": "C:\\...\\chromedriver.exe"
  }
}
```
Ошибка:
```json
{ "code": -1, "msg": "profile not found", "data": {} }
```
Поведение: если профиль уже запущен — вернуть существующие эндпоинты (идемпотентно).

### `GET /api/v1/browser/stop?user_id=<profileId>`
Останавливает профиль (убивает процесс браузера).
```json
{ "code": 0, "msg": "success", "data": {} }
```

### `GET /api/v1/browser/list?page_size=100&page=1`
Список профилей. (Альтернатива: `POST /api/v2/browser-profile/list`.)
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "list": [
      { "user_id": "p_123", "name": "FB account 1", "status": "closed", "group_id": "g_1" }
    ],
    "page": 1,
    "page_size": 100,
    "total": 1
  }
}
```

### `POST /api/v1/browser-profile/create`
Создаёт профиль. Тело:
```json
{ "name": "FB account 1", "group_id": "g_1", "proxy": { "type": "socks5", "host": "1.2.3.4", "port": 1080, "username": "u", "password": "p" } }
```
Успех:
```json
{ "code": 0, "msg": "success", "data": { "user_id": "p_124" } }
```

### Прокси (Фаза 3)

#### `POST /api/v1/proxy/create`
Создаёт прокси. Тело:
```json
{ "type": "http|https|socks5|ssh", "host": "1.2.3.4", "port": 1080, "username": "u", "password": "p", "privateKey": "-----BEGIN ..." }
```
Успех: `{ "code": 0, "msg": "success", "data": { "proxy_id": "x_..." } }`

#### `GET /api/v1/proxy/list`
Список прокси:
```json
{ "code": 0, "msg": "success", "data": { "list": [ { "proxy_id": "x_1", "type": "socks5", "host": "1.2.3.4", "port": 1080, "username": "u", "country": "BG", "timezone": "Europe/Sofia", "status": "ok" } ], "total": 1 } }
```

#### `POST /api/v1/proxy/update`
Тело: `{ "proxy_id": "x_...", ...поля как в create (все опциональны) }`.

#### `POST /api/v1/proxy/delete`
Тело: `{ "proxy_id": "x_..." }`. Ошибка, если прокси привязан к профилю.

#### `POST /api/v1/proxy/check`
Проверяет прокси запросом через него к ip-api.com и сохраняет результат (status/country/timezone).
Тело: `{ "proxy_id": "x_..." }`
Ответ:
```json
{ "code": 0, "msg": "success", "data": { "ok": true, "ip": "78.90.183.137", "country": "Bulgaria", "timezone": "Europe/Sofia", "latencyMs": 155 } }
```
Для SSH-прокси временно поднимается локальный SOCKS5-туннель.

#### `POST /api/v1/browser-profile/update`
Привязка прокси к профилю (или отвязка). Тело: `{ "user_id": "p_...", "proxy_id": "x_..." | null }`.

### Заметки по прокси
- HTTP/HTTPS/SOCKS5: `--proxy-server` ядра; **авторизация по паролю — через CDP `Fetch.continueWithAuth`** (ядро не поддерживает inline-креды).
- SSH: локальный SOCKS5-туннель (ssh2 + собственный SOCKS5-сервер RFC 1928).
- Авто-timezone: при запуске профиля `--timezone` берётся из timezone прокси, если у профиля не задана явно.

### Устройства (Фаза 4)

#### `GET /api/v1/device/list`
Список пресетов устройств (встроенные: Windows 10/11, macOS, Android Pixel 8, iPhone 15):
```json
{ "code": 0, "msg": "success", "data": { "list": [ { "device_id": "dev_macos", "name": "macOS", "platform": "mac", "config": { "platform": "macos", "platformVersion": "15.2.0", "brand": "Chrome", "hardwareConcurrency": 8, "lang": "en-US" } } ], "total": 5 } }
```

#### `POST /api/v1/device/create`
Тело: `{ "name": "My Device", "platform": "win|mac|linux|ios|android", "config": { ... } }`.
Успех: `{ "code": 0, "msg": "success", "data": { "device_id": "dev_..." } }`

#### `POST /api/v1/device/update` / `POST /api/v1/device/delete`
Тело update: `{ "device_id": "dev_...", ...поля как в create (опциональны) }`. Тело delete: `{ "device_id": "dev_..." }`.

#### Привязка устройства к профилю
`POST /api/v1/browser-profile/update` с `{ "user_id": "p_...", "device_id": "dev_macos" | null }` (можно вместе с `proxy_id`).

### Заметки по устройствам
- **Десктопные пресеты** (win/mac/linux): применяются ядром — `--fingerprint-platform`, `--fingerprint-platform-version`, `--fingerprint-brand`, `--fingerprint-hardware-concurrency`, `--lang`, `--timezone`.
- **Мобильные пресеты** (ios/android): CDP-эмуляция — `Emulation.setDeviceMetricsOverride` (screen/DPR), `setTouchEmulationEnabled`, `setUserAgentOverride`. Ядро остаётся `windows` (UA мобильный — главный сигнал).
- Приоритет: явные параметры профиля/фингерпринта перекрывают пресет устройства.

### Firefox (Camoufox) — управляемая модель (Juggler)

Firefox-профили (`browser_type: 'firefox'`) не отдают CDP ws (Juggler не открывает порт CLI-флагом). Управление — через API-методы:

#### `POST /api/v1/browser-profile/create` с `browser_type: 'firefox'`
```json
{ "name": "ff-1", "browser_type": "firefox" }
```
→ `{ "code": 0, "data": { "user_id": "p_..." } }`

#### `GET /api/v1/browser/start?user_id=<id>` (firefox)
→ `{ "code": 0, "data": { "browser_type": "firefox", "url": "about:blank" } }` (вместо ws)

#### `POST /api/v1/browser/firefox/navigate`
Тело: `{ "user_id": "p_...", "url": "https://example.com" }`
→ `{ "code": 0, "data": { "url": "...", "title": "..." } }`

#### `POST /api/v1/browser/firefox/evaluate`
Тело: `{ "user_id": "p_...", "expression": "navigator.userAgent" }`
→ `{ "code": 0, "data": { "result": "..." } }`

#### `GET /api/v1/browser/firefox/title?user_id=<id>`
→ `{ "code": 0, "data": { "title": "..." } }`

#### `GET /api/v1/browser/stop?user_id=<id>` (firefox)
→ `{ "code": 0, "data": {} }`

### Rate limits
Эндпоинты списка/cookies — 1 запрос/сек (как у AdsPower). Остальные — без жёсткого лимита.

## Примеры подключения автоматизаций

### Puppeteer (Node.js)
```js
import puppeteer from 'puppeteer-core';
const res = await fetch('http://localhost:50325/api/v1/browser/start?user_id=p_123', {
  headers: { Authorization: 'Bearer ' + API_KEY },
}).then(r => r.json());
const browser = await puppeteer.connect({ browserWSEndpoint: res.data.ws.puppeteer, defaultViewport: null });
const [page] = await browser.pages();
await page.goto('https://whoer.net');
```

### Playwright (Node/Python)
```js
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP(res.data.ws.puppeteer);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://whoer.net');
```
```python
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    browser = pw.chromium.connect_over_cdp(data["ws"]["puppeteer"])
    page = browser.contexts[0].pages[0]
    page.goto("https://whoer.net")
```

### Selenium
```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
opts = Options()
opts.add_experimental_option("debuggerAddress", data["ws"]["selenium"])
driver = webdriver.Chrome(data["webdriver"], options=opts)
driver.get("https://whoer.net")
```

## Заметки реализации
- `ws.puppeteer` строится из `DevToolsActivePort`: `ws://127.0.0.1:<port><ws-path>`.
- `ws.selenium` = `127.0.0.1:<port>` (для `debuggerAddress`).
- `webdriver` — путь к chromedriver соответствующей версии (для Selenium); в MVP может указывать на системный/скачанный драйвер.
- Запущенные профили трекаются в памяти (Map profileId → {pid, port, ws}); статус пишется в БД.
