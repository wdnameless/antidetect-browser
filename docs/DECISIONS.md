# Архитектурные решения (ADR)

## ADR-001: Kernel-level спуфинг через готовый патченый Chromium
- **Контекст:** суть AdsPower — kernel-модификация Chromium. Варианты: (a) JS-инъекции, (b) готовый патченый Chromium, (c) свой форк с нуля.
- **Решение:** использовать open-source `fingerprint-chromium` (Ungoogled Chromium + патчи, флаг `--fingerprint <seed>`).
- **Последствия:** реальный stealth без написания C++-патчей; зависимость от чужой сборки; нужно подтвердить Windows-бинарник/сборку в Фазе 0. Fallback — CDP-stealth.
- **Статус (Фаза 0): ПОДТВЕРЖДЕНО.** Есть готовые Windows-бинарники (installer + portable ZIP, x86-64), лицензия BSD-3-Clause, проект активен (релиз на каждую мажорную версию Chromium). Ядро форсит `navigator.webdriver=false` и имеет CDP-stealth (тихий `Runtime.enable`), что решает обнаруженную в smoke-тесте проблему `webdriver:true`. Детали, флаги и план интеграции — в [`docs/KERNEL.md`](KERNEL.md).

## ADR-002: AdsPower-совместимый Local API
- **Контекст:** пользователю нужно связывать браузер со своими автоматизациями; возможны существующие AdsPower-скрипты/MCP.
- **Решение:** повторить контракт AdsPower Local API (база `http://localhost:50325`, Bearer-token, формат `{code,msg,data}`, поля `ws.puppeteer`/`ws.selenium`/`debug_port`/`webdriver`).
- **Последствия:** существующие тулзы работают без переделки; привязка к формату AdsPower (придётся поддерживать совместимость).
- **Статус (Фаза 0): реализовано и верифицировано** (start/stop/list/create + Bearer-auth; подключение Puppeteer по `ws.puppeteer` работает).

## ADR-003: Платформа MVP — Windows
- **Контекст:** целевая ОС пользователя; скорость доставки.
- **Решение:** MVP только под Windows; mac/Linux позже.
- **Последствия:** меньше работы по упаковке/ядру; electron-builder нацелен на Windows.

## ADR-004: Скоуп — личный инструмент
- **Контекст:** цель — персональный инструмент под автоматизации, не коммерческий продукт.
- **Решение:** MVP = профили + прокси + фингерпринты + смена девайса + API. Без команды/облака/биллинга/RPA.
- **Последствия:** быстрый путь к ценности; архитектура допускает расширение позже.

## ADR-005: Стек — Electron + React + Vite + TS + SQLite + Node/Express
- **Контекст:** нужен десктоп + локальный сервис + UI; есть OSS-референсы на Electron.
- **Решение:** Electron (обёртка), React+Vite (UI), Node/TS/Express (Local Service), better-sqlite3 (БД), zod (валидация).
- **Последствия:** один язык (TS) на UI и бэкенд; локальная БД без сервера. Альтернатива UI на будущее — Tauri.
- **Заметка (Фаза 0):** `better-sqlite3` поднят до `^13` (есть prebuild под Node 24; v11 требовала компиляции node-gyp).

## ADR-006: Запуск браузера — прямой spawn + CDP, не Puppeteer-launch
- **Контекст:** нужно отдавать CDP-эндпоинт внешним автоматизациям (как AdsPower).
- **Решение:** спавнить Chromium через `child_process` с флагами и `--remote-debugging-port=0`, читать `DevToolsActivePort`, возвращать ws-эндпоинт. Puppeteer/Playwright используются только в примерах-клиентах.
- **Последствия:** полный контроль флагов ядра; независимость от версии Puppeteer; требуется аккуратное управление процессами/портами.
- **Статус (Фаза 0): верифицировано** (реальный запуск Chrome, чтение `DevToolsActivePort`, подключение Puppeteer по возвращённому ws).

## ADR-007: Нативные модули в Electron — РЕШЕНО (sql.js)
- **Контекст:** `better-sqlite3` — нативный модуль; для Electron требовал пересборки под ABI Electron (`electron-rebuild` → node-gyp → build tools, которых нет в окружении: VS2022 без Windows SDK).
- **Решение (Фаза 5):** заменить на `sql.js` (WASM, чистый JS) с адаптером, повторяющим API better-sqlite3 (`prepare/run/get/all/exec`). Бэкенд больше не содержит нативных модулей и работает прямо в Electron main без пересборки. `better-sqlite3` удалён.
- **Последствия:** стандартная упаковка electron-builder; нет зависимости от build tools; БД персистится в файл при каждой записи (приемлемо для локального инструмента).
- **Статус (Фаза 5): РЕШЕНО и верифицировано** — упакованное приложение (`release/win-unpacked`) запускается, бэкенд стартует, API отвечает; инсталлятор NSIS собран. Детали — [`docs/ENVIRONMENT.md`](ENVIRONMENT.md).

## ADR-008: Замена Electron на десктопную оболочку Tauri v2 (SUPERSEDES ADR-005)
- **Контекст:** В ADR-005 десктопной оболочкой был выбран Electron. На практике бэкенд оказался полностью отвязан от Electron (`node dist/src/main/index.js` запускает полноценный сервис без Electron-зависимостей), рендерер общается с сервисом исключительно по HTTP REST API, а реальный функционал Electron сводился к ~300 строкам кода (`electron/main.ts` + `preload.ts`), реализующим окно, системный трей, диалоги и DPAPI. За этот минимальный слой приходилось платить ~150 МБ встроенного Chromium и вторым экземпляром браузерного движка в памяти.
- **Решение:** Перевести основной десктопный билд с Electron на легковесную оболочку Tauri v2 (`src-tauri/`). Решение ADR-005 о стеке Electron суперседится данным ADR. При этом бэкенд **остаётся на Node.js** (переписывание бэкенда на Rust не планируется); оболочка является нативным окном и системным клеем над запущенным сервисом. Решение ADR-007 по `sql.js` (WASM/чистый JS) остаётся в силе и не затрагивается.
- **Аудит функционала Electron и замена компонентов:**

  | Функционал Electron | Чем заменён в Tauri |
  |---|---|
  | `BrowserWindow` (frameless, minimize/toggle-maximize/close) | Tauri webview (`decorations: false`) + core window API |
  | `contextBridge` preload `window.antidetect` | Внедряемый скрипт инициализации (`src-tauri/src/bridge.js`) |
  | `data:*` IPC (директория get/set/migrate/open, открытие логов) | Аутентифицированный HTTP API (`/api/v1/data/*`) + shell dialogs |
  | `electron.safeStorage` (DPAPI) | Rust DPAPI-команда (`src-tauri/src/secrets.rs`) с обратной совместимостью с префиксом `enc:` |
  | `powerMonitor` + `setContentProtection` (защита экрана) | Tauri `set_content_protected` + Win32 idle/power/session в Rust |
  | `electron-updater` + проверка подписанного манифеста | `tauri-plugin-updater` + собственная валидация манифеста и связки ключей в Rust |
  | Трей (Tray), single instance | Нативный системный трей Tauri + `tauri-plugin-single-instance` |
  | `before-quit` graceful shutdown | `POST /api/v1/shutdown` перед принудительным завершением процесса |

- **Ограничения платформ и честный статус:**
  - **Windows** — единственная платформа, на которой сборка собрана и верифицирована.
  - **macOS / Linux** — поставляются исключительно как конфигурация; артефакты под них пока не публикуются.
  - Защита от захвата экрана (`set_content_protected`) работает кроссплатформенно, но автоблокировка по бездействию (measured-idle) и блокировка при выходе из сессии (session-lock) в данной волне реализованы только под Windows (через Win32 API).
  - Electron-скрипты сохраняются в кодовой базе ровно на один релиз в качестве запасного варианта (fallback), после чего будут удалены.
