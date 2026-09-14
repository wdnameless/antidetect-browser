# NullTrace

**Zero footprint, infinite scale.** _Leave nothing behind._

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

## Портативные сборки / Portable Distribution

NullTrace поддерживает запуск без инсталлятора на всех трех поддерживаемых платформах:

- **Windows**: единый портативный исполняемый файл `.exe` (`NullTrace-<version>-portable-win-x64.exe`). Запускается без прав администратора, хранит секреты через Windows DPAPI (`safeStorage`).
- **Linux**: портативный пакет `.AppImage` (`NullTrace-<version>-portable-linux-x64.AppImage`).
- **macOS**: образ диска `.dmg` (`NullTrace-<version>-portable-mac-arm64.dmg`) под архитектуру Apple Silicon (arm64).

### Ограничения macOS / macOS Limitations

1. **Не является single-file**: на macOS дистрибутив поставляется в виде `.dmg`, содержащего `.app`-бандл приложения. В силу архитектуры macOS и правил формирования Application Bundle, поставка в виде единого бинарного файла невозможна.
2. **Подпись ad-hoc, без Developer ID и нотаризации**: у проекта нет платного Apple Developer account, поэтому сборка не подписана сертификатом разработчика. Однако на Apple Silicon любой arm64-код обязан иметь подпись — иначе его откажется загружать ядро системы, независимо от Gatekeeper. Поэтому сборка автоматически подписывается **ad-hoc** (`codesign -s -`, бесплатно, без сертификата): это удовлетворяет загрузчик, но не Gatekeeper.
3. **Карантин Gatekeeper**: при первом запуске macOS заблокирует запуск, потому что подпись ad-hoc не выдаёт Developer ID. Чтобы запустить приложение, необходимо один раз снять атрибут карантина в терминале:
   ```bash
   xattr -dr com.apple.quarantine /Applications/NullTrace.app
   ```
   (или указать путь к скачанному `.app` / смонтированному образу). Developer ID + нотаризация убрали бы этот шаг, но не требуются для запуска.

## Сборка дистрибутивов

```bash
npm run dist:win             # Windows portable .exe
npm run dist:linux           # Linux .AppImage
npm run dist:mac             # macOS .dmg (arm64)
```

Примеры подключения автоматизаций — в [`examples/`](examples/). Тесты — [`scripts/smoke.ts`](scripts/smoke.ts), [`scripts/smoke-automation.ts`](scripts/smoke-automation.ts), [`scripts/verify-stealth.ts`](scripts/verify-stealth.ts) (Фаза 2: `webdriver=false` + уникальность фингерпринтов), [`scripts/smoke-proxy.ts`](scripts/smoke-proxy.ts) (Фаза 3), [`scripts/verify-device.ts`](scripts/verify-device.ts) (Фаза 4).


## Легковесная десктоп-оболочка Tauri (Экспериментально)

В качестве альтернативы Electron-обёртке доступна легковесная десктоп-оболочка на базе [Tauri](https://tauri.app) (`src-tauri/`).

### Честное разграничение: что требует установки, а что нет

1. **Веб-интерфейс (`npm run service`)** — это то, что **действительно не требует установки** и работает с нулевым следом: запускается локальный HTTP-сервис (`API_PORT=50325`), открывается в любом стандартном браузере (Chrome, Edge, Firefox, Safari), не устанавливает десктопных приложений.
2. **Tauri-оболочка (`src-tauri`)** — это **устанавливаемое / исполняемое нативное десктопное приложение**. Мы честно заявляем: оболочка является нативным бинарником для конкретной ОС, а не веб-страницей. Она запускает локальный Node.js-сервис в режиме sidecar и отображает интерфейс через системный WebView (WebView2 на Windows, WebKitGTK на Linux, WKWebView на macOS).

### Ограничения платформ и подпись (macOS Gatekeeper / Quarantine)

- **Windows**: собирается `.msi` / `.exe` под x64 (WebView2 runtime).
- **Linux**: собирается `.deb` / `.AppImage` под x64 (WebKitGTK).
- **macOS (arm64 Apple Silicon)**: собирается `.dmg` / `.app`. На Apple Silicon любой arm64-код обязан иметь подпись — иначе ядро откажется его загружать, независимо от Gatekeeper. Поэтому сборка **обязана** быть хотя бы **ad-hoc** подписана (`codesign -s -`, бесплатно, без сертификата). Платного Apple Developer account у проекта нет, поэтому Developer ID и нотаризации нет.
  - **Electron-сборка** (`npm run dist:mac`): ad-hoc подпись применяется автоматически хуком `scripts/afterPack-adhoc-sign.cjs`.
  - **Tauri-оболочка**: то же самое через `bundle.macOS.signingIdentity = "-"` в `src-tauri/tauri.conf.json`. Сборка требует macOS-раннера с установленным Tauri CLI и здесь не проверялась.
- **Карантин Gatekeeper**: подпись ad-hoc не выдаёт Developer ID, поэтому при первом запуске система заблокирует приложение. Снять карантин нужно один раз:
  ```bash
  xattr -dr com.apple.quarantine /Applications/NullTrace.app
  ```
## Лицензия / правовая оговорка

Инструмент для легитимного управления собственными аккаунтами и автоматизации. Использование для обхода ToS платформ, мошенничества или нарушения законов — на ответственности пользователя.
