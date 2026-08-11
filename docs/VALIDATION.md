# Валидация stealth и утечек

Результаты проверок профиля на ядре `fingerprint-chromium` (Chrome 148).

## Верифицировано (автоматически)

| Проверка | Результат | Скрипт |
|---|---|---|
| `navigator.webdriver` | `false` (на стоковом Chrome — `true`) | `verify-stealth.ts` |
| Canvas-фингерпринт уникален на профиль | ✅ (разные hash при разных seed) | `verify-stealth.ts` |
| `hardwareConcurrency` спуфлен по seed | ✅ | `verify-stealth.ts` |
| Смена девайса: macOS → `MacIntel`/Mac UA | ✅ | `verify-device.ts` |
| Смена девайса: iPhone → мобильный UA/touch/`393x852@3x` | ✅ | `verify-device.ts` |
| Прокси с авторизацией (CDP `Fetch.continueWithAuth`) | ✅ | `smoke-proxy.ts` |
| Авто-timezone по IP прокси | ✅ (`Europe/Sofia`) | `smoke-proxy.ts` |
| **Cookie-инжекция** (CDP `Network.setCookies`) | ✅ (cookie виден в браузере) | `verify-geo-cookies.ts` |
| **Geolocation-спуфинг** + авто-grant на каждый origin | ✅ (координаты применяются) | `verify-geo-cookies.ts` |
| **Расширения**: импорт (папка/zip), привязка, загрузка (service worker стартует) | ✅ | `verify-extensions.ts` |
| **Расширения**: content scripts | ✅ **исправлено** — инъекция работает (причина была в `--disable-extensions-except`) | `verify-extensions.ts` |
| **Batch**: batch-create (round-robin прокси), CSV-import, batch-bind, batch-delete | ✅ | `verify-batch.ts` |

## Расширения: content scripts — ИСПРАВЛЕНО

Ранее content scripts не инъектировались при `--load-extension`. **Корневая причина:** флаг `--disable-extensions-except` (передавался вместе с `--load-extension`) блокировал инъекцию content scripts на ядре `fingerprint-chromium`. **Исправление:** оставлен только `--load-extension` (без `--disable-extensions-except`).

Проверено (`verify-extensions.ts`): расширение загружается (service worker виден в `browser.targets()`), content script выполняется — `console.log` и DOM-мутация (`data-sprint-b-ext`) появляются на странице. Стабильно на повторных прогонах.

## WebRTC / UDP-утечки — ПОЛНОСТЬЮ ИСКЛЮЧЕНЫ

Ядро **полностью отключает WebRTC API**: `RTCPeerConnection`, `webkitRTCPeerConnection`, `navigator.mediaDevices` — все `undefined` (`verify-webrtc.ts`). Нет WebRTC → нет UDP-утечек (ни host/srflx/relay-кандидатов). Это сильнее политики «disable non-proxied UDP»: утечка невозможна в принципе.

**Компромисс:** WebRTC-сайты (видеозвонки, часть dApps) не работают. Если нужен WebRTC через прокси (как у AdsPower), потребуется другая политика ядра — на текущем бинарнике WebRTC выключен наглухо.

## Внешние детекторы (best-effort)

- `pixelscan.net/fingerprint-check` и `browserscan.net` **загружаются в нашем браузере** (Cloudflare/анти-бот не блокирует — уже показатель, что браузер не определяется как бот).
- Чистый вердикт «pass/fail» автоматически не снимается: детекторы требуют клика и заполняют результат динамически. Для подтверждения нужен ручной прогон.
- Заявленные результаты ядра `fingerprint-chromium` (от автора): CreepJS ~51.5%, PixelScan (audio) pass, BrowserScan (GPU — возможны оговорки), Cloudflare Turnstile pass.

## Живой прогон на реальных сайтах и бенчмарках (`verify-live.ts`, `verify-benchmarks.ts`)

### Content scripts на реальных сайтах — ✅ PASS
| Сайт | Результат |
|---|---|
| example.com | ✅ content script выполнился |
| wikipedia.org | ✅ content script выполнился |
| httpbin.org/html | ✅ content script выполнился |

### Бенчмарки антидетекта
| Бенчмарк | Результат |
|---|---|
| **creepjs** | ✅ WebRTC **blocked** (host+stun), **0% headless**, **0% stealth** — не определяется как антидетект/автоматизация |
| **whoer** | disguise **70%** (Moderate), Proxy: No, Blacklist: No |
| **pixelscan** | ✅ **No automated behavior detected**; ⚠️ **"Fingerprint is inconsistent"** (см. ниже) |
| **browserscan** | данные согласованы: Chrome 148, Windows 11, timezone Europe/Sofia (совпадает с IP) |
| **EFF Cover Your Tracks** | тест запустился (кнопка нажата), вердикт в битах не захвачен автоматически |
| **browserleaks** | загрузился, вердикт требует ручного прохода по под-тестам |

### BrowserLeaks под-тесты (`verify-benchmarks2.ts`)
| Тест | Результат |
|---|---|
| **WebRTC Leak Test** | ✅ **No Leak** (Local IP: -, Public IP: -) — подтверждено на реальном тесте |
| **Canvas Fingerprint** | Uniqueness **100%** (seed-спуфинг даёт уникальность на профиль) |
| **WebGL Report** | спуфинг работает (WebGL Report Hash + Image Hash) |
| **TLS Client Test** | TLS 1.3/1.2 enabled, 1.1/1.0 disabled (Good); **JA4** `t13d1516h2_8daaf6152771_d8a2da3f94cd` — TLS-стек НЕ спуфится (ограничение ядра; AdsPower упоминает TLS-контроль) |

### ⚠️ pixelscan: «Fingerprint is inconsistent» — источник найден (Tier 2)
Эмпирический подбор (`tune-fingerprint.ts`) локализовал источник:

| Конфиг | Вердикт pixelscan |
|---|---|
| default | inconsistent |
| `disableSpoofing: canvas` | ✅ **consistent** |
| `disableSpoofing: audio` | inconsistent |
| `disableSpoofing: audio,canvas` | ✅ **consistent** |

**Вывод:** inconsistency даёт **canvas-спуфинг ядра** (audio/GPU/fonts/timezone — не источник; авто-timezone по egress IP уже согласована). Это компромисс seed-подхода `fingerprint-chromium`: canvas-шум обеспечивает **уникальность между профилями** (проверено в `verify-stealth.ts`), но pixelscan считает его нереалистичным.

**Решение:** canvas-спуфинг оставлен **включённым по умолчанию** (уникальность критична для мультиаккаунтинга; pixelscan при этом не детектит автоматизацию). Для максимальной consistency можно выключить canvas per-profile через `POST /api/v1/browser-profile/fingerprint` `{config:{disableSpoofing:'canvas'}}` — но тогда все профили одной машины получат одинаковый canvas.

**Сравнение с AdsPower:** по детекции автоматизации мы на уровне (creepjs 0% stealth, pixelscan no-automation). По согласованности canvas AdsPower сильнее (coherent-пресеты вместо seed-шума) — это ограничение текущего ядра, не решаемое флагами.

## Открытые пункты
- Ручное подтверждение pass на pixelscan/browserscan/creepjs.
- Тест WebRTC-утечки **через SOCKS-прокси** (нужен внешний прокси; сейчас WebRTC выключен, так что утечка исключена независимо от прокси).
- TLS-fingerprint (JA3/JA4) — не проверялся; не подтверждено, что ядро его спуфит.
