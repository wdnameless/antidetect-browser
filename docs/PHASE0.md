# Фаза 0 — Фундамент + проверка ядра

## Цель
Рабочий скелет: приложение запускается, Local API стартует/останавливает профиль Chromium и отдаёт CDP-эндпоинт. Принято решение по патченому ядру.

## Задачи

### 0.1 Scaffold монорепо
- [x] `package.json` (name `antidetect-browser`, scripts: `dev`, `build`, `start`, `typecheck`, `install-chromium`, `service`).
- [x] `tsconfig.base.json` + `tsconfig.main.json` (CJS) + `src/renderer/tsconfig.json` (ESM/Bundler). Модульный режим зафиксирован: main = CommonJS, renderer = ESM (Vite).
- [x] `.gitignore` (node_modules, dist, `data/`, *.log), `.editorconfig`.
- [x] Electron `main.ts` (окно + запуск сервиса), `preload.ts` (contextBridge).
- [x] Vite + React skeleton: sidebar + страницы (Profiles — рабочая; Proxies, Fingerprints, Devices, Settings — заглушки).

### 0.2 Хранилище
- [x] better-sqlite3 соединение (`src/main/db/index.ts`), версия `^13` (prebuild под Node 24).
- [x] Схема + миграции (`src/main/db/schema.ts`) по `ARCHITECTURE.md`.

### 0.3 Launcher
- [x] `src/main/launcher/chromium.ts`: spawn Chromium с `--user-data-dir`, `--proxy-server`, `--remote-debugging-port=0`, `--no-first-run`, `--no-default-browser-check`.
- [x] Поллинг `DevToolsActivePort` → `{ ws.puppeteer, ws.selenium, debug_port, pid }`.
- [x] `stopProfile` (kill процесса), Map запущенных профилей, идемпотентный start.
- [x] Заглушка под флаги `--fingerprint` (включатся в Фазе 2, см. `KERNEL.md`).

### 0.4 Local API (AdsPower-совместимый)
- [x] Express на `127.0.0.1:50325`, Bearer-auth middleware.
- [x] `GET /status`, `GET /api/v1/browser/start`, `POST /api/v2/browser-profile/start`, `GET /api/v1/browser/stop`, `GET /api/v1/browser/list`, `POST /api/v2/browser-profile/list`, `POST /api/v1/browser-profile/create`.
- [x] Формат ответов строго по `API_CONTRACT.md`.

### 0.5 Профили
- [x] `profileManager`: CRUD, генерация fingerprint seed, дефолтный конфиг, `resolveLaunchConfig`.

### 0.6 Ядро (исследование)
- [x] `fingerprint-chromium`: Windows-бинарник ЕСТЬ (installer + ZIP, x86-64), Chrome 148, лицензия BSD-3-Clause, активен. Сборка не нужна.
- [x] Решение зафиксировано: ADR-001 подтверждён, детали в `KERNEL.md`.

### 0.7 Примеры и утилиты
- [x] `scripts/install-chromium.mjs` (@puppeteer/browsers).
- [x] `examples/`: Puppeteer / Playwright / Selenium подключения.
- [x] `scripts/smoke.ts` и `scripts/smoke-automation.ts` — smoke-тесты бэкенда и автоматизации.

## Критерии готовности (Definition of Done)
1. [x] `npm install && npm run typecheck` проходят без ошибок.
2. [ ] `npm run dev` открывает окно Electron с UI-скелетом. _(renderer typechecks и собирается vite build; запуск Electron заблокирован средой: не скачивается бинарник Electron и нет build tools для пересборки `better-sqlite3` под ABI Electron. См. `docs/ENVIRONMENT.md`, ADR-007. Не блокер для автоматизации — бэкенд работает standalone.)_
3. [x] Через API: создать профиль → start → получить `ws.puppeteer` → подключиться Puppeteer → выполнить JS в профиле → stop. **(верифицировано `smoke-automation.ts`)**
4. [x] Профили изолированы (разные `user-data-dir`), прокси применяется (флаг `--proxy-server`).
5. [x] Принято и задокументировано решение по ядру (`KERNEL.md`, ADR-001).

## Верификация (выполнено)
- `npm run typecheck` (main + renderer) — без ошибок.
- `npm run build:renderer` (vite build) — успешно.
- `smoke.ts`: /status, create, list, отказ без auth, реальный запуск Chrome + CDP-эндпоинт + stop.
- `smoke-automation.ts`: Puppeteer подключился по `ws.puppeteer` из API и выполнил `page.evaluate` в контексте профиля.
- Обнаружено: на стоковом Chrome `navigator.webdriver === true` → решается ядром fingerprint-chromium (Фаза 2).

## Вне скоупа Фазы 0
Реальный спуфинг фингерпринтов (Фаза 2), UI-формы создания профилей (достаточно заглушки + API), упаковка/инсталлятор (Фаза 5).
