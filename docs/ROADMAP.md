# Roadmap до MVP

Оценка — соло-разработка с AI-помощью, платформа Windows, подход «патченый Chromium».
Текущая готовность: **MVP собран, расширен и укреплён** — фазы 0–5 + Tier 1 + Tier 2 (coherent-пресеты, Camoufox) + продуктовая полировка v0.2.11–v0.2.20 (группы, bulk, защита данных, тесты/CI, пакеты профилей, логи). Подробная история — [`../CHANGELOG.md`](../CHANGELOG.md). Осталось: TLS-исследование зафиксировано (см. `VALIDATION.md`), опциональные Tier 3 и i18n.

## Фазы

### Фаза 0 — Фундамент + проверка ядра (~1 неделя) — ✅ выполнена
- Монорепо: Electron + React + TS + SQLite, линтеры, структура.
- Launcher: запуск Chromium с `--user-data-dir`, `--proxy-server`, `--remote-debugging-port=0`; чтение `DevToolsActivePort` → CDP-эндпоинт.
- AdsPower-совместимый Local API: `start/stop/list/create` + Bearer-auth.
- Исследование `fingerprint-chromium`: Windows-бинарник/сборка, флаги, лицензия.
- **Критерий выхода:** скелет запускается; API стартует/останавливает профиль и отдаёт CDP ws; решение по ядру принято. ✔

### Фаза 1 — Local API как приоритет №1 (~1–2 недели) — ✅ выполнена
- Полная реализация AdsPower-совместимых эндпоинтов и формата ответов.
- CRUD профилей/групп, статусы running/closed, трекинг запущенных процессов.
- Примеры подключения: Puppeteer, Playwright, Selenium, Python.
- **Критерий выхода:** автоматизации подключаются по `ws.puppeteer` и управляют профилем. ✔ (подтверждено `smoke-automation.ts`)

### Фаза 2 — Фингерпринты (~2–4 недели) — ✅ выполнена (ядро + stealth + валидация)
- ✅ Подмена executable на патченый Chromium, включение `--fingerprint <seed>` + override-флагов.
- ✅ Детерминированный seed на профиль, привязка фингерпринта к профилю.
- ✅ Верификация: `webdriver=false`, уникальный canvas/hardwareConcurrency на профиль (`verify-stealth.ts`).
- ✅ WebRTC полностью отключён ядром → UDP-утечки исключены (`verify-webrtc.ts`).
- ✅ Живой прогон: creepjs 0% stealth, pixelscan «No automated behavior detected», whoer 70%, BrowserLeaks WebRTC No Leak / Canvas 100% (`verify-live.ts`, `verify-benchmarks.ts`, `verify-benchmarks2.ts`).
- ✅ Tier 2: авто-timezone по egress IP; источник «inconsistent» на pixelscan локализован (canvas-спуфинг ядра); per-profile `disableSpoofing` через API (`tune-fingerprint.ts`).
- **Критерий выхода:** профили проходят основные детекторы с высоким score; нет утечек WebRTC/UDP. ✔ (canvas «inconsistent» — ограничение ядра, см. `VALIDATION.md`)

### Фаза 3 — Прокси-менеджер (~1 неделя) — ✅ выполнена
- ✅ Типы HTTP/HTTPS/SOCKS5/SSH, CRUD, привязка к профилю, проверка доступности.
- ✅ Авторизованные прокси через CDP `Fetch.continueWithAuth` (ядро `--proxy-server` не поддерживает пароль).
- ✅ SSH-прокси: локальный SOCKS5-туннель (ssh2 + собственный SOCKS5-сервер RFC 1928).
- ✅ Автоопределение timezone по IP прокси (ip-api.com), применяется при запуске профиля.
- ✅ «Безлимит»: отсутствие искусственных ограничений в БД.
- ✅ Верификация (`smoke-proxy.ts`): HTTP+auth через CDP, egress IP, timezone `Europe/Sofia`, SOCKS5 — все PASS.
- **Критерий выхода:** прокси назначаются/меняются на профиль, IP и timezone согласованы. ✔

### Фаза 4 — Смена девайса (~1–2 недели) — ✅ выполнена
- ✅ Пресеты устройств: Windows 10/11, macOS, Android (Pixel 8), iPhone 15 (встроенные, сид при старте).
- ✅ Десктопные пресеты — ядро: `--fingerprint-platform`/`-version`, `--fingerprint-brand`, `--fingerprint-hardware-concurrency`.
- ✅ Мобильные пресеты — CDP-эмуляция: `setDeviceMetricsOverride` (screen/DPR), `setTouchEmulationEnabled`, `setUserAgentOverride`.
- ✅ Привязка `device_id` к профилю (`browser-profile/update`), CRUD устройств.
- ✅ Верификация (`verify-device.ts`): macOS → `MacIntel`/Mac UA; iPhone → мобильный UA, touch, `393x852@3x`, `maxTouchPoints=5` — PASS.
- **Критерий выхода:** профиль корректно меняет «устройство», детекторы показывают выбранный девайс. ✔

### Фаза 5 — Полировка и упаковка (~1–2 недели) — ✅ выполнена (MVP собран)
- ✅ ADR-007 решён: БД переведена на `sql.js` (WASM) — бэкенд без нативных модулей, работает в Electron main без пересборки (build tools не нужны).
- ✅ Десктоп-приложение: Electron запускает бэкенд in-process, окно + Local API; graceful shutdown (остановка браузеров при выходе).
- ✅ UI: рабочие страницы Proxies, Devices, Extensions, Settings; Profiles (start/stop + batch-create + CSV-import + cookies + fingerprint + extensions).
- ✅ Упаковка: electron-builder NSIS-инсталлятор `release/Antidetect Browser Setup 0.1.0.exe` + `release/win-unpacked/`.
- ✅ Верификация: упакованное приложение (`win-unpacked`) запускается, бэкенд стартует, Local API отвечает.
- ⏳ Не вошло в MVP: группы/batch-операции (частично — batch есть, групп-UI нет), cookie import/export (есть API+UI), start URLs, автообновление ядра, подпись кода.
- **Критерий выхода:** устанавливаемый MVP, стабильный цикл «создать профиль → назначить прокси/фингерпринт → запустить API → автоматизировать». ✔

### Критические фичи (Tier 1) — ✅ выполнены
- ✅ **Cookie import/export** (CDP `Network.setCookies`/`getAllCookies`) — `verify-geo-cookies.ts` PASS.
- ✅ **Geolocation-спуфинг** + авто-grant на каждый origin — `verify-geo-cookies.ts` PASS.
- ✅ **Расширения** (импорт папки/zip, привязка, `--load-extension`; content scripts исправлены — убран `--disable-extensions-except`) — `verify-extensions.ts` PASS.
- ✅ **Batch** (batch-create round-robin, CSV-import, batch-bind, batch-delete) — `verify-batch.ts` PASS.

### Tier 2 — ✅ частично выполнено
- ✅ **Coherent-пресеты**: `brandVersion`, `disableSpoofing` в fingerprint-конфиг; авто-timezone по egress IP; источник «inconsistent» локализован (canvas-спуфинг ядра).
- ✅ **Firefox-ядро (Camoufox)**: скачано, запускается через `playwright@1.60.0` (Juggler); managed-модель (`launcher/firefox.ts` + API navigate/evaluate/title) — `verify-firefox.ts` PASS.
- ✅ **TLS-фингерпринт (JA3/JA4) — исследован** (`probe-tls.ts`, tls.peet.ws): fingerprint-chromium отдаёт аутентичный Chromium/BoringSSL JA4 (`t13d1516h2_8daaf6152771_…`), Camoufox — аутентичный Firefox JA4. Подмена стека невозможна, но подделка и не нужна: TLS совпадает с реальным браузером соответствующего движка. ADR: развитие Firefox-ветки опционально.
- ⏳ **Нативная мобильная эмуляция** (iOS/Android на уровне ядра): CDP-эмуляция работает, kernel-level — нет.

### Продуктовая полировка v0.2.11–v0.2.20 — ✅ выполнена
- ✅ Пул 30 Android-моделей + ручной seed + фиксация модели (v0.2.11).
- ✅ Страница Groups, дублирование профилей, rate limits 20/s + авто-retry 429 (v0.2.12).
- ✅ UX-полировка: пустые состояния, гид по прокси, favicon (v0.2.13–14).
- ✅ Bulk-панель, фильтры платформа/статус, копирование seed (v0.2.15).
- ✅ **Защита данных**: атомарная БД (tmp+rename), автобэкапы, crash recovery, tree-kill, вотчдог, graceful shutdown, single-instance lock, hardening API (v0.2.16).
- ✅ Vitest + GitHub Actions CI (v0.2.17).
- ✅ Серверные bulk-эндпоинты, серверный поиск, пагинация (v0.2.18).
- ✅ Пакеты профилей (экспорт/импорт), структурированные логи с ротацией (v0.2.19).
- ✅ Netscape cookies.txt (импорт/экспорт), шифрование паролей прокси (DPAPI), проверка обновления ядра (v0.2.20).

## Итого

**MVP готов и расширен.** Все ключевые фичи реализованы и верифицированы: автоматизации по изолированным профилям с реальным stealth (`webdriver=false`, уникальные фингерпринты, WebRTC off), прокси-менеджер (HTTP/HTTPS/SOCKS5/SSH + auth через CDP + авто-timezone), смена девайса, cookies/geolocation/расширения/batch, Firefox-ядро (Camoufox, managed), устанавливаемый Windows-инсталлятор.

## Критический путь

`Launcher + API (Фаза 0–1)` → `патченое ядро + фингерпринты (Фаза 2)` → `прокси (Фаза 3)` → `девайсы (Фаза 4)` → `полировка/упаковка (Фаза 5)` → `Tier 1 (cookies/geo/extensions/batch)` → `Tier 2 (coherent, Camoufox)`.
Все пройдено; MVP собран. Дальнейшее — опциональная полировка и полная валидация детекторов.

## Риски

| Риск | Влияние | Митигация |
|---|---|---|
| Ребейз Chromium под новые версии | долгосрочная поддержка | зафиксировать версию ядра (сейчас 148), обновлять осознанно |
| Canvas «inconsistent» на pixelscan | средний score | ограничение ядра; per-profile `disableSpoofing: canvas`; Camoufox (Skia) — потенциально лучше |
| TLS-fingerprint (JA3/JA4) не спуфится | палево на продвинутых WAF | Camoufox (стек Firefox); отдельный спринт |
| Camoufox — beta, активная разработка | нестабильность | зафиксировать версию 152.0.4-beta.28; следить за релизами |
| SSH-прокси (доступность сервера, ключи) | профиль не стартует | проверка прокси перед запуском; понятные ошибки |
| Детект CDP-автоматизации | баны | CDP-stealth ядра (`webdriver=false` подтверждён) + тесты creepjs/pixelscan |
