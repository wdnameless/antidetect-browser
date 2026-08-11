# Окружение и запуск

## Текущее окружение
- Node.js v24.17.0, npm 11.
- Windows; нет C++ build tools (VS2022 без Windows SDK) — **больше не требуется**: в проекте нет нативных модулей (БД на sql.js/WASM, см. ADR-007).

## Запуск
- **Десктоп-приложение (Electron):** `npm install && npm run start` (соберёт main + renderer и запустит). Либо `npm run dev` (Vite + Electron в dev-режиме).
- **Только бэкенд (Local API):** `npm run service` → API на `http://localhost:50325` (ключ печатается в консоль).
- **Сборка инсталлятора:** `npm run dist` → `release/Antidetect Browser Setup <ver>.exe` (NSIS) + `release/win-unpacked/`.
- **Ядро браузера:** `npm run install-chromium` скачает Chrome for Testing; приоритет — патченый `fingerprint-chromium` из `data/chromium/`, затем системный Chrome.

## ADR-007 (решено в Фазе 5)
Нативный `better-sqlite3` заменён на `sql.js` (WASM) с адаптером под API better-sqlite3 (`prepare/run/get/all/exec`). Бэкенд работает и в Node (standalone), и в Electron main без пересборки. Упаковка electron-builder стандартная, build tools не нужны.

**Верификация:** упакованное приложение (`release/win-unpacked/Antidetect Browser.exe`) запускается, бэкенд стартует внутри Electron, Local API отвечает; инсталлятор NSIS собран (`npm run dist`).

## Данные
- Профили / БД / API-ключ: `%APPDATA%/antidetect-browser/` (в packaged-приложении) или `./data/` (в dev/standalone, если не задан `ANTIDETECT_DATA_DIR`).
- Ядро `fingerprint-chromium`: `data/chromium/fingerprint-chromium/`.

## Известные ограничения
- Порт Local API фиксирован (50325 по умолчанию, переопределяется `API_PORT`); при занятом порте бэкенд не стартует — освободите порт.
- Приложение не подписано кодом (SmartScreen может предупредить при установке).
