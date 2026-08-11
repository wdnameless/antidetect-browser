# Анализ AdsPower (что клонируем)

AdsPower — крупнейший антидетект-браузер (9M+ пользователей). Создаёт изолированные браузерные профили с уникальными фингерпринтами и прокси для мультиаккаунтинга (e-commerce, affiliate, crypto, social).

## Ключевые модули

### Профили
- Каждый профиль = отдельная среда: свои cookies, history, passwords, fingerprint, прокси.
- Группы/папки, batch-создание и импорт (до 1000 профилей из Excel/TXT).
- Profile sharing между участниками команды (платно).

### Фингерпринты (ядро ценности)
50+ параметров в ~25 категориях, генерируются **coherent**-наборами под заявленную ОС/GPU:
- Идентификаторы: User-Agent, platform, vendor, language, timezone.
- Рендеринг: Canvas, WebGL, AudioContext, WebGPU, IndexedDB.
- Сеть: WebRTC (режим «Disable UDP»), TLS-fingerprint («Disable TLS Features»).
- Устройство: screen resolution, device memory, hardware concurrency, battery API.
- Шрифты/плагины: кастомные списки.fonts, plugins.
- Мобильная симуляция: iOS + Android (touch API, screen metrics, accelerometer).
- «Random fingerprint»: регенерация UA/WebGL/CPU/RAM при запуске (платно).

### Прокси
- Типы: HTTP, HTTPS, SOCKS5, SSH. 200+ стран.
- Привязка к профилю, проверка прокси, случайное назначение, авто-согласование IP/timezone.
- Модель bring-your-own-proxy (свой прокси-инфраструктура).

### Автоматизация и API (главное для нас)
- **Local API**: REST на `http://localhost:50325`, Bearer-token. Эндпоинты запуска/остановки/списка/создания профилей.
- Ответ запуска содержит CDP-эндпоинты: `ws.puppeteer` (ws URL) и `ws.selenium` (debuggerAddress), `debug_port`, путь к `webdriver`.
- Интеграция: Selenium, Puppeteer, Playwright (через `connectOverCDP` / `debuggerAddress`).
- Встроенный no-code RPA, Multi-Window Synchronizer (не клонируем в MVP).
- MCP Server для AI-агентов (Claude/Cursor).

### Команда / предприятие (не клонируем в MVP)
Суб-аккаунты, role-based permissions, activity logs, cloud sync.

### Тарифы (референс)
Free (2 профиля) · Professional (~$9/мес, 10 профилей, **API — платная фича**) · Business (~$48/мес, команда) · Enterprise (custom).

## Технические подходы к антидетекту (сравнение)

| Подход | Суть | Stealth | Сложность |
|---|---|---|---|
| 1. Config-level | правка UA/разрешения/языка/timezone | низкий | тривиально |
| 2. JS-инъекции | перехват Canvas/WebGL/Audio через CDP `evaluateOnNewDocument` / расширение | средний (палится: `toString`, prototype chain, timing) | умеренная |
| 3. **Kernel-level** | патчи C++/Blink в исходниках Chromium до компиляции | **высокий** (нет JS-шва, нативные read-API) | высокая |

AdsPower использует **подход 3** (своё ядро SunBrowser, Chromium; + FlowerBrowser, Firefox). У них отдельная «kernel team», ребейзящая Chromium каждый релиз.

Open-source референсы:
- `fingerprint-chromium` (adryfish) — патчи Ungoogled Chromium, флаг `--fingerprint <seed>`, CDP-stealth. **Наш выбор ядра.**
- Camoufox (патченый Firefox), CloakBrowser (66 C++-патчей Chromium) — для изучения приёмов.
- `@aitofy/browser-profiles`, `coderkhalide/Anti-Detect-Browser` (Electron+React+Puppeteer) — референсы MVP-архитектуры на CDP-инъекциях.

## Что клонируем vs пропускаем (MVP)

| Функция | MVP |
|---|---|
| Профили + группы | ✅ |
| Kernel-level фингерпринты | ✅ (Фаза 2) |
| Безлимит прокси + привязка | ✅ |
| Смена девайса / пресеты | ✅ |
| Local API (AdsPower-совместимый) | ✅ (приоритет №1) |
| Cookie import | ✅ (полировка) |
| Команда/роли, cloud sync | ❌ |
| Биллинг/тарифы | ❌ |
| RPA, Synchronizer | ❌ |
| Firefox-ядро | ❌ |
