# Antidetect Browser (working title)

Персональный антидетект-браузер — функциональный клон **AdsPower**, заточенный под связку с собственными автоматизациями через Local API.

> Статус: **MVP собран (Фазы 0–5).** Устанавливаемый Windows-инсталлятор готов и верифицирован: профили, фингерпринты (kernel-level stealth, `webdriver=false`), прокси-менеджер (HTTP/HTTPS/SOCKS5/SSH + авторизация через CDP + авто-timezone), смена девайса, AdsPower-совместимый Local API. См. `docs/ROADMAP.md`, `docs/ENVIRONMENT.md`.

## Что это

Десктоп-приложение (Windows), которое:

- создаёт **изолированные браузерные профили** (отдельные cookies, fingerprint, прокси на профиль);
- управляет **безлимитными прокси** (HTTP/HTTPS/SOCKS5/SSH);
- генерирует и привязывает **фингерпринты** (kernel-level спуфинг через патченый Chromium);
- поддерживает **смену девайса** (пресеты Win/macOS/iOS/Android);
- предоставляет **AdsPower-совместимый Local REST API** — главная фича: ваши скрипты (Puppeteer / Playwright / Selenium / Python) запускают профиль и получают CDP-эндпоинт для полного управления.

## Ключевой принцип автоматизации

API не управляет страницами сам. Он **запускает изолированный браузер** и отдаёт CDP WebSocket-эндпоинт. Дальше ваша автоматизация рулит браузером напрямую через `connectOverCDP` / `debuggerAddress`. Это 1-в-1 модель AdsPower, поэтому существующие AdsPower-скрипты и MCP работают без переделки.

## Стек

| Слой | Технология |
|---|---|
| Десктоп-обёртка | Electron |
| UI | React + Vite + TypeScript |
| Локальный сервис / API | Node.js + TypeScript + Express |
| Хранилище | SQLite через sql.js (WASM, без нативных модулей) |
| Браузерное ядро | патченый Chromium (`fingerprint-chromium`, флаг `--fingerprint <seed>`) |
| Платформа MVP | Windows |

## Документация

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — архитектура, компоненты, модель данных, структура.
- [`docs/SERVER_DEPLOY.md`](docs/SERVER_DEPLOY.md) / [`SERVER_DEPLOY.ru.md`](docs/SERVER_DEPLOY.ru.md) — **развёртывание на своём Windows-сервере**: веб-панель + стрим браузера, CDP-туннель для автоматизаций, WireGuard + Traefik, всё бесплатно.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — план по фазам до MVP.
- [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) — контракт Local API + примеры подключения автоматизаций.
- [`docs/ADSPOWER_ANALYSIS.md`](docs/ADSPOWER_ANALYSIS.md) — разбор функционала AdsPower и технических подходов.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — зафиксированные архитектурные решения (ADR).
- [`docs/KERNEL.md`](docs/KERNEL.md) — браузерное ядро fingerprint-chromium: флаги, интеграция, ограничения.
- [`docs/PHASE0.md`](docs/PHASE0.md) — текущая фаза: задачи, критерии готовности, верификация.

## Быстрый старт

```bash
npm install
npm run install-chromium   # скачать ядро Chromium (или использовать системный Chrome)
npm run dev                # Electron + Vite dev (UI + Local API)

# или только бэкенд без UI:
npm run service            # Local API на http://localhost:50325 (API-ключ печатается в консоль)
```

## Установка (MVP)

```bash
npm run dist               # сборка инсталлятора (electron-builder, NSIS)
```
Результат: `release/Antidetect Browser Setup <ver>.exe` (установщик) и `release/win-unpacked/` (портативная версия). Приложение не подписано кодом — SmartScreen может предупредить при установке.

Примеры подключения автоматизаций — в [`examples/`](examples/). Тесты — [`scripts/smoke.ts`](scripts/smoke.ts), [`scripts/smoke-automation.ts`](scripts/smoke-automation.ts), [`scripts/verify-stealth.ts`](scripts/verify-stealth.ts) (Фаза 2: `webdriver=false` + уникальность фингерпринтов), [`scripts/smoke-proxy.ts`](scripts/smoke-proxy.ts) (Фаза 3), [`scripts/verify-device.ts`](scripts/verify-device.ts) (Фаза 4).

## Лицензия / правовая оговорка

Инструмент для легитимного управления собственными аккаунтами и автоматизации. Использование для обхода ToS платформ, мошенничества или нарушения законов — на ответственности пользователя.
