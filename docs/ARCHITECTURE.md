# Архитектура

## Цели

- Персональный антидетект-браузер (клон AdsPower) под Windows.
- Ядро ценности — **Local API для автоматизаций**: запуск изолированного профиля и выдача CDP-эндпоинта.
- Kernel-level спуфинг фингерпринтов (патченый Chromium), а не JS-инъекции.

## Не-цели (MVP)

Командные роли, облачный sync, биллинг/тарифы, визуальный RPA, Multi-Window Synchronizer, Firefox-ядро.

## Обзор компонентов

```
┌─ Tauri Desktop Shell (Rust + системный WebView) ┐
│  webview (decorations: false) · Tray · Dialogs │
│  Rust DPAPI (secrets.rs) · Screen/Idle Protection│
└───────────────┬─────────────────────────────────┘
                │ HTTP / loopback & bridge.js
                ▼
┌─ Local Service (автономный Node.js / TS REST) ─┐
│  Запускается как sidecar или автономно         │
│  config.ts        — пути, порты, API key        │
│  db/              — SQLite (sql.js WASM)        │
│  profiles/        — CRUD профилей               │
│  launcher/        — запуск/остановка Chromium   │
│  api/             — Express REST :50325         │
└───────────────┬─────────────────────────────────┘
```
                │ spawn child_process
                ▼
┌─ Браузерное ядро ─────────────────────────────┐
│  патченый Chromium (fingerprint-chromium)      │
│  --user-data-dir=<profile>                     │
│  --proxy-server=<proxy>                        │
│  --fingerprint=<seed> (+ override-флаги)       │
│  --remote-debugging-port=0                     │
└───────────────┬───────────────────────────────┘
                │ DevToolsActivePort → CDP ws
                ▼
┌─ Автоматизации пользователя ──────────────────┐
│  Puppeteer.connect / Playwright.connectOverCDP │
│  Selenium debuggerAddress / Python CDP         │
└───────────────────────────────────────────────┘
```

## Поток данных (запуск профиля автоматизацией)

1. Клиент → `GET /api/v1/browser/start?user_id=<id>` (Bearer token).
2. API → `profileManager` читает профиль из SQLite (прокси, fingerprint seed, настройки).
3. `launcher` спавнит Chromium с `--user-data-dir`, `--proxy-server`, `--fingerprint <seed>`, `--remote-debugging-port=0`.
4. `launcher` поллит файл `<userDataDir>/DevToolsActivePort`: 1-я строка = порт, 2-я = ws-путь (`/devtools/browser/<GUID>`).
5. API возвращает AdsPower-совместимый ответ с `ws.puppeteer` (ws URL) и `ws.selenium` (`127.0.0.1:<port>`).
6. Клиент коннектится через `connectOverCDP(ws.puppeteer)` и управляет браузером.
7. `GET /api/v1/browser/stop?user_id=<id>` убивает процесс браузера.

## Технологический стек

| Слой | Технология | Обоснование |
|---|---|---|
| Десктопная оболочка | Tauri v2 (Rust) | лёгкий нативный бинарник, системный WebView (WebView2 под Windows), нативные диалоги и трей, меньший footprint памяти |
| UI | React + Vite + TS | быстрый dev, единый код для веб-сервиса и десктопного окна |
| Сервис/API | Node.js + TS + Express | полностью автономный локальный сервис (запускается без оболочки или как sidecar в десктопе) |
| БД | SQLite (sql.js WASM) | автономная работа без нативных бинарных модулей и без пересборки под ABI оболочки |
| Ядро | fingerprint-chromium | kernel-level спуфинг без написания C++ патчей, скачивается при первом старте |
| Валидация | zod | строгая валидация входных данных Local API |
Десктопным билдом является оболочка Tauri v2 (`src-tauri/`). Electron удалён полностью: исходники, зависимости и скрипты сборки. Обновления подписываются minisign-ключом, публичная половина которого лежит в `tauri.conf.json`, а приватная — только в CI-секрете.

## Модель данных (SQLite)

```sql
CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE proxies (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('http','https','socks5','ssh')),
  host        TEXT NOT NULL,
  port        INTEGER NOT NULL,
  username    TEXT,
  password    TEXT,
  country     TEXT,
  status      TEXT DEFAULT 'unknown',   -- unknown|ok|fail
  created_at  INTEGER NOT NULL
);

CREATE TABLE fingerprints (
  id          TEXT PRIMARY KEY,
  label       TEXT,
  seed        INTEGER NOT NULL,         -- детерминированный seed ядра
  config_json TEXT NOT NULL,            -- переопределения (UA, GPU, screen, ...)
  created_at  INTEGER NOT NULL
);

CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,            -- пресет устройства
  platform    TEXT NOT NULL,            -- win|mac|ios|android
  config_json TEXT NOT NULL             -- UA, screen, touch, hardwareConcurrency, ...
);

CREATE TABLE profiles (
  id             TEXT PRIMARY KEY,
  name           TEXT,
  group_id       TEXT REFERENCES groups(id),
  proxy_id       TEXT REFERENCES proxies(id),
  fingerprint_id TEXT REFERENCES fingerprints(id),
  device_id      TEXT REFERENCES devices(id),
  user_agent     TEXT,
  timezone       TEXT,
  geolocation    TEXT,
  cookies_json   TEXT,
  start_urls     TEXT,                  -- JSON array
  status         TEXT DEFAULT 'closed', -- closed|running
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
```

Профиль = точка сборки: при запуске `launcher` берёт связанные proxy/fingerprint/device и формирует флаги Chromium.

## Структура проекта

```
antidetect browser/
├── README.md
├── docs/                      # эта документация
├── package.json
├── tsconfig.base.json
├── .gitignore                 # node_modules, dist, data/, *.log
├── .editorconfig
├── src-tauri/                 # десктопная оболочка Tauri v2 (Rust)
│   ├── src/
│   │   ├── main.rs            # окно, команды, жизненный цикл
│   │   ├── sidecar.rs         # запуск/остановка Node-бэкенда
│   │   ├── screen.rs          # capture-protection + Win32 idle/power/session
│   │   ├── secrets.rs         # DPAPI (CurrentUser) + слой Electron safeStorage
│   │   ├── tray.rs            # системный трей
│   │   ├── updater.rs         # проверка/установка обновлений
│   │   └── bridge.js          # внедряемый мост window.antidetect
│   ├── capabilities/          # ACL для IPC с удалённого origin
│   ├── windows/portable.nsi   # шаблон single-file portable артефакта
│   └── tauri.conf.json
├── mcp/                       # MCP-сервер (отдельная точка входа, запускается приложением)
│   ├── src/                   # tools, auth (scope), audit
│   └── dist/                  # собирается и поставляется в бандле
├── scripts/                   # build-portable, vendor-node, copy-prod-deps,
│                              # build-updater-manifest, ensure-kernel, ensure-chromedriver
├── resources/                 # release-keyring.json (доверенные ключи релиза)
├── src/
│   ├── main/                  # автономный бэкенд (Node.js REST-сервис)
│   │   ├── index.ts           # bootstrap сервиса
│   │   ├── config.ts          # пути/порты/API key
│   │   ├── db/
│   │   │   ├── index.ts       # соединение
│   │   │   └── schema.ts      # таблицы + миграции
│   │   ├── profiles/
│   │   │   └── profileManager.ts
│   │   ├── launcher/
│   │   │   └── chromium.ts    # spawn + DevToolsActivePort → CDP
│   │   └── api/
│   │       ├── server.ts      # Express на :50325
│   │       ├── auth.ts        # Bearer token
│   │       └── routes/
│   │           └── browser.ts # start/stop/list/create
│   └── renderer/              # React + Vite
│       ├── index.html
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           └── pages/         # Profiles, Proxies, Fingerprints, Devices, Settings
├── examples/                  # Puppeteer/Playwright/Selenium примеры подключения
├── scripts/
│   └── install-chromium.mjs   # скачать ядро (@puppeteer/browsers)
└── data/                      # runtime (gitignored): профили, БД, ядро
```

## Стратегия по ядру (fingerprint-chromium)

- Используем open-source патченый Ungoogled Chromium: спуфинг Canvas/WebGL/Audio/navigator/clientRects управляется флагом `--fingerprint <seed>` + override-флагами (`--fingerprint-platform`, `--fingerprint-gpu-vendor`, `--fingerprint-hardware-concurrency`, ...).
- Ядро также содержит CDP-stealth (`navigator.webdriver=false`, тихий `Runtime.enable`) — важно для автоматизаций.
- **Фаза 0** использует стоковый Chromium (launcher отрабатывает механику). **Фаза 2** подменяет executable на патченый и включает флаги фингерпринтов.
- Открытые вопросы Фазы 0: наличие готового Windows-бинарника, актуальность версии Chromium, лицензия, процедура сборки/ребейза.

## Безопасность

- Сервис слушает только loopback (`127.0.0.1`).
- Все вызовы API требуют `Authorization: Bearer <API_KEY>` (ключ генерируется и хранится локально).
- Прокси-пароли и cookies хранятся локально; на будущее — шифрование at-rest.
