# План внедрения критических фич (Tier 1)

Цель: закрыть 4 критических гэпа из [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md):
1. **Расширения** Chrome Web Store (per-profile)
2. **Cookie import/export**
3. **Geolocation-спуфинг**
4. **Batch/bulk-операции**

Все 4 фичи независимы друг от друга → можно делать в любом порядке или параллельно. Ниже — конкретика по каждой: схема БД, API, изменения launcher/CDP, UI, верификация.

## Статус внедрения (выполнено)

| Спринт | Фича | Статус | Верификация |
|---|---|---|---|
| A | **Cookie import/export** | ✅ готово | `verify-geo-cookies.ts` — cookie виден в браузере |
| A | **Geolocation-спуфинг** (+ авто-grant на каждый origin) | ✅ готово | `verify-geo-cookies.ts` — координаты применяются |
| B | **Расширения**: импорт (папка/zip), CRUD, привязка, `--load-extension` | ✅ готово | `verify-extensions.ts` — расширение загружается (service worker) |
| B | Расширения: **content scripts** | ✅ **исправлено** | инъекция работает; причина была в `--disable-extensions-except` — см. `VALIDATION.md` |
| C | **Batch**: batch-create (round-robin), CSV-import, batch-bind, batch-delete | ✅ готово | `verify-batch.ts` — BATCH PASS |

**Итог:** все 4 фичи готовы полностью. Регрессия ядра/профилей/API подтверждена (`smoke.ts` — SMOKE OK), typecheck (main+renderer) чистый.

Новые API-эндпоинты:
- `POST /api/v1/browser-profile/cookies/import`, `GET /api/v1/browser-profile/cookies/export`
- `POST /api/v1/browser-profile/update` (теперь принимает `geolocation`)
- `POST /api/v1/extension/import` / `GET /api/v1/extension/list` / `POST /api/v1/extension/delete`
- `POST /api/v1/browser-profile/extensions/bind`, `GET /api/v1/browser-profile/extensions`
- `POST /api/v1/browser-profile/batch-create` / `batch-delete` / `batch-bind-proxy` / `import`

---

## Общий подход

- **Паттерн CDP-attach уже есть**: `src/main/proxy/deviceEmulation.ts` и `proxyAuth.ts` подключаются к запущенному браузеру через `puppeteer.connect(ws)` и применяют команды CDP. Этот же паттерн используем для **cookies** и **geolocation**.
- **Единая точка применения на старте**: `launcher/chromium.ts::startProfile` после получения CDP-эндпоинта применяет всё, что нужно профилю (auth → device emulation → **cookies → geolocation**). Добавляем шаги в одном месте.
- **Схема БД**: миграции через `ensureColumn` (`src/main/db/schema.ts`) — без ломки существующих БД.
- **API**: AdsPower-совместимый стиль `{code,msg,data}`, роуты в `src/main/api/routes/`.
- **UI**: страницы в `src/renderer/src/pages/`, клиент в `src/renderer/src/api.ts`.

---

## Фича 1: Расширения (Chrome Web Store, per-profile)

**Модель:** общая библиотека расширений + привязка к профилям (как в AdsPower).

### Схема БД
```sql
CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  path TEXT NOT NULL,              -- абс. путь к распакованной папке расширения
  version TEXT, enabled INTEGER DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_extensions (
  profile_id TEXT NOT NULL, extension_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, extension_id)
);
```

### Импорт расширений
- Поддержка: **распакованная папка** и **.zip** (распаковать в `data/extensions/<id>/`).
- `.crx3` = zip с небольшим заголовком → для MVP либо просить распакованный вид/.zip, либо добавить распаковщик crx (библиотека). **MVP: папка + zip.**

### Launcher (`chromium.ts`)
```ts
const extPaths = getEnabledExtensionPaths(profileId); // из profile_extensions
if (extPaths.length) {
  args.push(`--load-extension=${extPaths.join(',')}`);
  args.push(`--disable-extensions-except=${extPaths.join(',')}`);
}
```
Ядро (ungoogled-chromium) поддерживает `--load-extension`. Chrome Web Store как каталог в ungoogled-сборке недоступен (нет Google-аккаунта), поэтому расширения ставятся распакованными — это стандарт для антидетектов.

### API
- `POST /api/v1/extension/import` `{name, path}` → `{extension_id}` (path — папка или zip).
- `GET /api/v1/extension/list` → список.
- `POST /api/v1/extension/delete` `{extension_id}`.
- `POST /api/v1/browser-profile/extensions/bind` `{user_id, extension_ids:[...]}` (заменяет набор).
- `GET /api/v1/browser-profile/extensions?user_id=` → привязанные.

### UI
- Страница **Extensions**: импорт (выбор папки/zip), список, удаление.
- В профиле — выбор расширений (привязка).

### Верификация
- Импорт тестового распакованного расширения → привязка к профилю → запуск → в браузере виден `chrome://extensions` с этим расширением / расширение активно (например, тестовое расширение меняет заголовок страницы).

**Усилия:** средние (3–4 дня).

---

## Фича 2: Cookie import/export

**Модель:** храним в `profiles.cookies_json` (уже есть); на старте инжектим через CDP; экспорт — из живого браузера.

### Формат
CDP-формат: `[{name, value, domain, path, expires, httpOnly, secure, sameSite, ...}]`. Поддержать также Netscape `cookies.txt` (парсер) — опционально.

### Launcher (`chromium.ts`) — инжект на старте
После CDP-эндпоинта, на page-target:
```ts
if (profile.cookies_json) {
  const cookies = JSON.parse(profile.cookies_json);
  const session = await pageTarget.createCDPSession();
  await session.send('Network.setCookies', { cookies });
}
```
(Ставится на about:blank до навигации пользователя — cookies готовы к нужным доменам.)

### API
- `POST /api/v1/browser-profile/cookies/import` `{user_id, cookies:[...], format:'json'|'netscape'}` → сохранить в `cookies_json`.
- `GET /api/v1/browser-profile/cookies/export?user_id=`:
  - если профиль **запущен** → живые cookies через `Network.getAllCookies` (CDP);
  - иначе → сохранённый `cookies_json`.

### UI
- В профиле: **Import** (вставить JSON / загрузить файл), **Export** (скачать JSON).

### Верификация
- Импорт cookie для домена → запуск профиля → навигация на домен → cookie присутствует (`document.cookie` / CDP getAllCookies). Экспорт запущенного профиля возвращает актуальные cookies.

**Усилия:** средние (2–3 дня).

---

## Фича 3: Geolocation-спуфинг

**Модель:** `profiles.geolocation` (уже есть, TEXT → JSON `{latitude, longitude, accuracy}`); применяем через CDP.

### Launcher (`chromium.ts`)
После CDP-эндпоинта:
```ts
if (geo) {
  await session.send('Emulation.setGeolocationOverride',
    { latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy ?? 50 });
  await session.send('Browser.grantPermissions',
    { origin: '*', permissions: ['geolocation'] }); // убрать запрос разрешения
}
```

### Авто-гео по прокси
`ip-api.com` возвращает и `lat/lng`. Расширить проверку прокси: сохранять `latitude/longitude` в таблицу `proxies` (миграция `ensureColumn`). Кнопка **«использовать локацию прокси»** копирует lat/lng прокси в geolocation профиля.

### API / UI
- Расширить `POST /api/v1/browser-profile/update`: принимать `geolocation:{latitude,longitude}`.
- UI: поля lat/lng + кнопка «из прокси».

### Верификация
- Задать гео → запуск → в браузере `navigator.geolocation.getCurrentPosition` возвращает заданные координаты.

**Усилия:** низкие (1–2 дня).

---

## Фича 4: Batch/bulk-операции

### API
- `POST /api/v1/browser-profile/batch-create`
  `{count, name_prefix, proxy_ids?:[...], device_id?, }` → создать N профилей, прокси round-robin.
- `POST /api/v1/browser-profile/import` `{profiles:[{name, proxy?, device?, timezone?, ...}]}` (из CSV/JSON).
- `POST /api/v1/browser-profile/batch-delete` `{user_ids:[...]}`.
- `POST /api/v1/browser-profile/batch-bind-proxy` `{user_ids:[...], proxy_ids:[...]}` (round-robin).

### CSV-импорт
Парсер CSV (заголовки: `name,proxy_type,proxy_host,proxy_port,proxy_user,proxy_pass,timezone,...`) → `import`.

### UI
- **Batch create**: диалог (кол-во, префикс, прокси-пул, девайс).
- **Импорт CSV**: загрузка файла → предпросмотр → импорт.
- **Мульти-выбор** в списке профилей + массовые действия (удалить, привязать прокси).

### Верификация
- batch-create 5 профилей с 2 прокси (round-robin) → созданы, прокси распределены. Импорт CSV → профили созданы. Массовое удаление работает.

**Усилия:** средние (2–3 дня).

---

## Последовательность и оценки

| Спринт | Фичи | Обоснование | Усилия |
|---|---|---|---|
| **A** | Geolocation + Cookies | обе используют CDP-attach паттерн — делаем вместе | ~3–5 дней |
| **B** | Расширения | отдельный механизм (флаги ядра + библиотека) | ~3–4 дня |
| **C** | Batch-операции | надстройка над CRUD + UI | ~2–3 дня |

Итого **~8–12 дней** на все 4 фичи. Фичи независимы — при желании можно параллелить (A и B одновременно).

## Сквозная верификация
После каждой фичи: `npm run typecheck` + целевой smoke-скрипт (по аналогии с `verify-stealth.ts`/`smoke-proxy.ts`). Финальный прогон: профиль с расширением + cookies + geolocation + прокси → запуск → всё применено одновременно.

## Риски
- **Расширения в ungoogled-ядре**: `--load-extension` поддерживается, но конкретная сборка может иметь нюансы → проверить в Спринте B первым делом (Slice 0: одно тестовое расширение).
- **Cookies с флагами SameSite/Secure**: некоторые сайты требуют точных атрибутов → хранить полный CDP-формат, не упрощать.
- **grantPermissions `origin:'*'`**: может требовать точный origin → при проблемах выдавать права на конкретные домены.
- **CSV-парсинг**: экранирование кавычек/запятых → использовать зрелый парсер или аккуратный собственный.

## Следующий этап (Tier 2, после Tier 1)
50+ параметров фингерпринта (WebGPU/IndexedDB/fonts) · Firefox-ядро (Camoufox) · нативная мобильная эмуляция · TLS-фингерпринт. Это отдельный план после закрытия Tier 1.
