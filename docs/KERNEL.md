# Браузерное ядро: fingerprint-chromium

## Решение (подтверждено в Фазе 0)

Используем [`fingerprint-chromium`](https://github.com/adryfish/fingerprint-chromium) (adryfish) — патченый **Ungoogled Chromium** с kernel-level спуфингом фингерпринтов. **ADR-001 подтверждён**: собирать ядро из исходников не требуется, есть готовые бинарники.

## Ключевые факты

- **Готовые Windows-бинарники**: installer `.exe` (~114 MB) и portable `.zip` (~181 MB), x86-64. Сборка из исходников **не нужна**.
- **Лицензия**: BSD-3-Clause (пермиссивная, подходит для нашего использования).
- **Активность**: ~2.9k★, релиз на каждую мажорную версию Chromium. Последняя: Chrome 148 (148.0.7778.215).
- **Релизы**: https://github.com/adryfish/fingerprint-chromium/releases
- **Скачать (Chrome 148, Windows ZIP)**:
  `https://github.com/adryfish/fingerprint-chromium/releases/download/148.0.7778.215/ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip`

## Что даёт ядро (решает наши задачи)

- **`navigator.webdriver = false`** (форсится) — напрямую решает проблему `webdriver: true`, обнаруженную в smoke-тесте со стоковым Chrome.
- **CDP-stealth**: вызов `Runtime.enable` не оставляет детектируемых следов → Puppeteer/Playwright палятся меньше.
- **`fakeShadowRoot`**: доступ к closed Shadow DOM для автоматизации.
- **Спуфинг**: User-Agent / platform / userAgentData + Client Hints, ОС, Audio, Plugins (фикс. список с 133+), CPU cores, deviceMemory (рандом 8/16/32 с Chrome 148), WebGL image + metadata (реалистичные GPU-наборы с 148), Fonts, Canvas image + text, ClientRects, WebRTC, Language, Timezone.

## Флаги командной строки

| Флаг | Назначение |
|---|---|
| `--fingerprint=<int32>` | seed; включает большинство спуфингов (детерминированно) |
| `--fingerprint-platform=windows\|linux\|macos` | тип ОС |
| `--fingerprint-platform-version` | версия ОС |
| `--fingerprint-brand=Chrome\|Edge\|Opera\|Vivaldi` | бренд в UA / UA-Data |
| `--fingerprint-brand-version` | версия бренда |
| `--fingerprint-hardware-concurrency=<int>` | число ядер CPU |
| `--timezone=<tz>` | часовой пояс (напр. `America/Los_Angeles`) |
| `--lang` / `--accept-lang` | язык (напр. `en-US`) |
| `--disable-non-proxied-udp` | WebRTC policy (по умолчанию non-proxied UDP выключен — рекомендуется оставить) |
| `--disable-spoofing=font,audio,canvas,clientrects,gpu` | точечно отключить спуфинг (Chrome 144+) |
| `--proxy-server=<scheme://host:port>` | прокси (**БЕЗ авторизации по паролю**) |

Устарели в Chrome 144: `--fingerprint-gpu-vendor`, `--fingerprint-gpu-renderer`, `--disable-gpu-fingerprint` (заменены на `--disable-spoofing=gpu`).

## Интеграция (Фаза 2) — ВЫПОЛНЕНО

1. ✅ Скачан Windows ZIP (Chrome 148), распакован в `data/chromium/fingerprint-chromium/`.
2. ✅ `config.getChromiumPath()`: приоритет `CHROMIUM_PATH` env → `data/chromium/fingerprint-chromium/<build>/chrome.exe` (автодетект) → другие сборки → системный Chrome → PATH.
3. ✅ `launcher/chromium.ts` передаёт флаги из фингерпринта профиля:
   `--fingerprint=<seed> --fingerprint-platform=<os> --fingerprint-brand=<brand> --fingerprint-hardware-concurrency=<n> --timezone=<tz> --lang=<lang>`.
4. ✅ Валидация (`scripts/verify-stealth.ts`): `webdriver === false` и уникальный canvas на профиль.

### Результат верификации (Фаза 2)

Два профиля (разные seed) на ядре Chrome 148, подключение Puppeteer через CDP:

| Сигнал | Профиль A | Профиль B | Итог |
|---|---|---|---|
| `navigator.webdriver` | `false` | `false` | ✅ (на стоковом Chrome было `true`) |
| canvas-фингерпринт | `1738295592` | `1076093782` | ✅ уникален на профиль |
| `hardwareConcurrency` | 22 | 12 | ✅ спуфинг по seed |
| User-Agent | Chrome/148 | Chrome/148 | соответствует ядру |

**STEALTH OK.** Осталось в Фазе 2: расширить валидацию на CreepJS / PixelScan / BrowserScan и проверить WebRTC/UDP-утечки.

## Ограничения и риски

- **`--proxy-server` не поддерживает авторизацию по паролю** → для парольных прокси нужна обработка через CDP `Fetch.continueWithAuth` (Фаза 3).
- GPU metadata spoofing исторически имел проблемы на Windows (BrowserScan); с Chrome 148 улучшено (реалистичные GPU-параметры) — требуется тестирование.
- Автор **не даёт техподдержки**; исходники патчей публикуются с задержкой (~1 месяц после релиза) — для нас не критично, т.к. используем бинарники.
- Обновление Chromium = скачивание нового релиза (не пересборка). Долгосрочно — фиксируем версию ядра.

## Результаты тестов (от автора ядра)

CreepJS ~51.5% · PixelScan (audio) pass · BrowserScan (GPU может иметь проблемы) · Cloudflare Turnstile pass.

## Кандидат на Firefox-ядро: Camoufox (оценка, Tier 2)

**Camoufox** (daijro, 11k★, BSD-3) — патченый Firefox с kernel-level stealth: canvas через Skia (не JS-шум), WebRTC с фиксами утечек через прокси, спуфинг local IP в SDP, CSS screen-size, fonts под платформу, humanized mouse trajectory.

- **Версия:** v152.0.4-beta.28 (Firefox 152), Windows x86_64 — **469 МБ** (zip).
- **Скачан и проверен:** `data/chromium/camoufox/extracted/camoufox.exe` → `Camoufox 152.0.4-beta.28` запускается.
- **⚠️ Протокол:** Camoufox использует **Juggler** (Firefox/Playwright), **НЕ CDP**. Наш launcher (spawn + `--remote-debugging-port` + DevToolsActivePort) и Puppeteer-автоматизация **не подойдут**.
- **Скоуп интеграции (отдельный спринт):**
  1. Firefox-launcher: spawn `camoufox.exe` с `--profile` (user-data-dir), Juggler-порт, чтение порта.
  2. API: для Firefox-профилей возвращать Juggler-эндпоинт (не CDP ws).
  3. Автоматизации: Playwright (`chromium` → `firefox`/`connectOverCDP` не работает; нужен `playwright.firefox.connect` или Juggler-клиент).
  4. Фингерпринт: Camoufox конфигурируется через `camoufox.cfg`/launch-аргументы (не `--fingerprint`).
- **Ценность:** Firefox-ядро даёт разнообразие против детекции, ориентированной на Chromium; canvas-спуфинг через Skia потенциально убирает «inconsistent» на pixelscan (в отличие от seed-шума fingerprint-chromium).
- **Решение:** интеграция — отдельный спринт после закрытия текущих пунктов; требует Playwright-зависимости и второго launcher-пути.

### Итоги эмпирической интеграции (текущая версия)

| Проверка | Результат |
|---|---|
| Node `playwright.firefox.launch({executablePath: camoufox.exe})` | ✅ **работает** с **Playwright 1.60.0** (в 1.62.1 — ошибка протокола Juggler `viewport.isMobile`) |
| UA в Camoufox | `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Camoufox/152.0.4-beta.28` |
| `--juggler` / `--juggler-port` CLI-флаги | ❌ не распознаны бинарником; Juggler включается только через Playwright-лаунчер |
| Внешний ws-эндпоинт (как CDP у Chromium) | ❌ **недоступен** — Juggler-порт не открывается CLI-флагом |

**Вывод:** Camoufox не вписывается в нашу модель «API отдаёт ws → внешняя автоматизация коннектится». Требуется **управляемая модель**: сервис сам держит `playwright.firefox`-инстанс и отдаёт управление через API-методы (newPage/goto/evaluate) либо Node-мост. Это **отдельный спринт** с новым API-слоем; совместимость с AdsPower-API (ws-модель) при этом не сохраняется для Firefox-профилей. `playwright@1.60.0` уже установлен в dependencies.

### Интеграция выполнена (управляемая модель)

| Компонент | Статус |
|---|---|
| `playwright@1.60.0` (dependencies) | ✅ (1.62.1 несовместим с Juggler Camoufox 152) |
| `config.getCamoufoxPath()` (env `CAMOUFOX_PATH` → `data/chromium/camoufox/extracted/camoufox.exe`) | ✅ |
| `profiles.browser_type` (`chromium`/`firefox`) + миграция | ✅ |
| `launcher/firefox.ts` — managed-лаунчер: `startFirefox` (launch+context+page), `navigate`, `evaluate`, `getTitle`, `stopFirefox`, `stopAllFirefox` | ✅ |
| API: `browser/start`/`stop` диспетчеризуют по `browser_type`; `POST /api/v1/browser/firefox/navigate`, `POST /api/v1/browser/firefox/evaluate`, `GET /api/v1/browser/firefox/title` | ✅ |
| Верификация (`verify-firefox.ts`) | ✅ **FIREFOX PASS**: create(firefox) → start → navigate(example.com) → evaluate(UA=`Camoufox/152.0.4-beta.28`) → title → stop |

**Ограничение модели:** для Firefox-профилей API возвращает `{browser_type:'firefox', url}` вместо CDP ws — внешние автоматизации не могут подключиться напрямую (Juggler не открывает порт CLI-флагом); управление идёт через API-методы navigate/evaluate/title. Прокси/таймзона/локаль передаются в `firefox.newContext`.
