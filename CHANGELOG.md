# Changelog

## [0.6.7] - 2026-09-19

### Changed — the panel has no password any more

The web panel no longer asks for credentials. Opening it takes you straight to the app, in the
desktop shell and in a plain browser alike.

**What was removed.** The whole `panelAuth` router (`/ui/setup`, `/ui/login`, `/ui/sessions`,
`/ui/auth-state`), the SPA login screen and the `authenticated` gate that could block startup,
the legacy `/ui` panel's "create the panel login and password" form with its login and
sign-out controls, and the scrypt credential store (`panel_auth.json`) plus the device log
(`panel_sessions.json`). Nothing writes or reads those files now.

**The part that was not obvious.** `/ui/login` was also how a *browser* client got hold of the
API key — the response's `token` field literally was the API key. The desktop shell injects
that key over the Tauri bridge, so the gate never appeared there; in a plain browser there is
no bridge, the key resolved to an empty string, and every request 401'd. Removing the password
without replacing that path would have left the install-free web panel permanently
`unauthorized` — the opposite of the goal.

So `GET /ui/key` now serves the key to the page the backend itself served. **Same-origin is
the entire security argument, and it is enforced:** a hostile page can fetch
`http://127.0.0.1:50325` directly (its Host *is* loopback) and read the body, so the request's
`Origin` must equal its `Host`. Unknown origins fail closed. A reverse-proxied entry point
(Traefik over VPN) keeps working, because there the page's origin and the Host agree.
Verified: a foreign `Origin` is refused with `403` and no key in the body.

**Cloud sync to a remote instance** used the same login endpoints to obtain that server's key.
Connecting now asks for the remote API key directly — take it from that machine's panel, where
the Automation API card shows it.

### Verified

- A real browser with no bridge opens the panel with **zero password inputs** and reaches the
  app fully authenticated (sidebar, all destinations, "AUTOMATION API On").
- The page's key equals the one `/ui/key` returns; the legacy `/ui` panel connects the same way.
- The four removed endpoints answer `401` (they fall through to auth middleware) — never `200`,
  so no credential can be minted for an instance that has none.
- `npm test` 131 files / 1088 passed; both typechecks clean.

## [0.6.6] - 2026-09-19

### Fixed — Settings showed no data folder, and folder changes could lie about failing

Three defects were reported together: an empty "Current folder", a transfer control that was
nowhere near the folder it acts on, and a left nav that looked uneven and cut off.

**The folder was never missing — the panel simply could not read the answer.** Every backend
route replies with the standard `{code, msg, data}` envelope, and `bridge.js` read `.dir` off
the envelope itself instead of `data.dir`. That is `undefined`, the helper fell back to `''`,
and Settings rendered its placeholder forever while the app served profiles out of
`D:\NULLTRACE` without complaint.

**The same misreading turned failures into successes.** `migrateDir` and `setDirPath` built
their result as `Object.assign({ ok: true, dir: target }, data)` — the literal `ok: true` is
applied *first* and the spread never overwrites it, so a refused migration reported success.
Neither read the envelope either, so the backend's own resolved `dir` and the `migrated` flag
were discarded. Both now translate through a single `unwrapResult()` helper beside `apiFetch`,
so the three callers cannot drift apart again. Refusals are now honest:

    setDirPath('')                -> { ok: false, error: "dir is required" }
    migrateDir(same folder)       -> { ok: false, error: "same or invalid folder" }

**Transfer moved next to Change Folder.** They act on the same thing — one moves the whole
installation, the other brings profiles into it — so *Transfer profiles…* now sits in the
Actions row beside *Change Folder…*, with the existing per-row transfer in the scan results
left untouched.

### Fixed — the left nav was cut off because it scrolled inside a scroller

`.sidebar-content` sets `overflow-y: auto` and `.sidebar nav` set its own `overflow-y: auto`
with `flex: 1`: two nested scroll containers. A tall footer squeezed the inner one, and the
last group came to rest below the inner fold. Measured at 1280×800 with a bundle-result
message present, the nav folded at 436px while **Settings sat at 455px** — present in the DOM,
unreachable in practice, and the source of the "uneven" look.

The footer had grown because a status message wrapped a long folder path onto four lines. Both
sides are fixed: the nav flows at its natural height (`.sidebar-content` is the only scroller),
and message rows are one line clipped with an ellipsis, with the full text kept in `title`.

**The collapsed rail had a third, separate cause.** The rule
`.sidebar.collapsed .automation-api-status *:not(.status-dot)` hides **elements**, but those
message rows carry their text in a bare text node, which no selector can match. They spilled
past the 36px rail — measured 294px against a rail edge at 52 — and were clipped mid-word,
which is the garbled strip that was visible in the rail. Those rows now hide outright; the
header's On/Off dot is nested a level deeper and still shows.

Five regression tests pin the envelope translation in both directions — all five fail on the
previous bridge and pass on this one.

## [0.6.5] - 2026-09-18

### Fixed — the update pill said "Update available" and then did nothing

The sidebar control was wired to **check only**. It reported the available version and stopped,
because `download()` and `quitAndInstall()` existed solely behind buttons inside
Settings → Updates — not where anyone looks when they wonder whether they are current. Nothing
in the footer could reach the end of the flow.

Clicking it now authorises the whole sequence and the footer advances itself as the shell
reports each step: `check → download → install → relaunch`. The same control shows the live
percentage while the artefact arrives and says **Installing…** while it is applied. The flow
still only ever starts from a click — a background check cannot begin a download on its own.

Two more defects were found in the same panel while fixing it, and they are why the settings
page looked dead:

- **Settings' update panel rendered nothing.** It subscribed to the shell's payload but switched
  on the *UI's* vocabulary — `'available'`, `'downloading'` — while the shell emits
  `update-available`, `download-progress`, `update-downloaded`. Every state fell through to no
  branch, so the panel was empty and its **Download** and **Restart & install** buttons were
  unreachable. The footer had its own private mapping and dropped `download-progress`
  entirely, so progress could never have been shown there either. Both now translate through one
  tested function (`src/renderer/src/updateStatus.ts`), which is what stops them drifting apart
  again.

### Fixed — the portable build could not replace itself

Even with a download path, the portable swap was impossible as written:
`ping -n 3 … & move /Y … & start …`. Three things were wrong, each verified by experiment:

1. **Nothing ever closed the app.** The portable branch emitted "staged successfully, please
   restart" and returned — it never exited. With a live process holding the target,
   `move /Y` answers **"Access is denied. 0 file(s) moved."**, the staged file survives, the
   move fails, and `start` then relaunches the **old** binary. That is precisely the operator's
   report: click, nothing happens.
2. **The `ping` was a race, not a synchronisation.** It waited a fixed ~2 s regardless of
   whether the process had released the file, and neither checked the move's result nor surfaced
   a failure.
3. **The wait had to be for the *app*, not for the file.** The swap target is the launcher, and
   the launcher does not stay resident — it extracts the shell, `Exec`s it, then exits. Its file
   is therefore already unlocked while the app is still running, so a move-only helper would
   replace and relaunch it immediately, starting the new version while the old one still held
   port 50325 and the single-instance mutex — two instances racing for the same backend.

The helper now waits for the app's own PID to exit, then replaces the launcher with a retrying,
verified move, and starts the new build only after that succeeds. If the app never exits, or the
file stays locked, it writes `<target>.update-failed`, exits non-zero, leaves the staged payload
in place for a retry, and **starts nothing** — so a failed update can no longer masquerade as a
successful one by quietly relaunching the old version.

Verified by executing the generated script rather than reading it: against a *running* process
holding the target it waited, then replaced the file atomically once the holder exited; against
a locked target it exited `1`, wrote the breadcrumb, left the target byte-identical and kept the
staged file.

### Fixed — the installed build's updater orphaned the backend

`tauri-plugin-updater`'s Windows install path ends in `ShellExecuteW` followed by
`std::process::exit(0)`. That hard exit does not run Tauri's `RunEvent::Exit`, so the graceful
teardown never happened: the Node backend kept running, holding port 50325 and the instance
lock, and the next launch found a lock it misreads as a crash. The updater now runs the same
teardown through the plugin's `on_before_exit` hook, so the sidecar is stopped and the port
released before the installer takes over.

## [0.6.4] - 2026-09-18

### Added — profiles from another data folder can be brought across

The recovery scan already *found* a folder holding your profiles; the only thing it offered
was **Use this folder**, which switches the working folder and restarts. If you preferred the
folder you were already using, the profiles were stranded. Settings → Data Folder → *Recover
old data* now offers **Transfer profiles here** beside that switch.

Transfer is an import into the folder in use, not a relocation: the data-root setting never
changes, the source folder is opened read-only and keeps its profiles, and anything already in
the destination keeps its own values — a matching id is counted as *already present* rather
than overwritten. Fingerprints, devices, proxies and groups are carried over first, so a
transferred profile can be launched straight away. The counts reported are the rows actually
written.

Two defects had to be fixed to make it honest. `INSERT OR IGNORE` does **not** fail when a
NOT NULL column is missing — SQLite skips the row and reports zero changes, which is exactly
what a duplicate reports, so the first version counted silent drops as "already present" and
could claim success while moving nothing. Destination NOT NULL columns the source does not
carry are now filled (a timestamp column gets "now"), and "already present" is established by
looking the id up, not inferred from a change count.

### Fixed — the portable build updated itself with an installer

An in-app update on the portable `.exe` fetched the NSIS **setup** and wrote it over the
launcher — the portable build would have replaced itself with an installer. Getting this right
took more than adding a key, because the plugin resolves a release by probing
`{os}-{arch}-{bundle_type}` and then `{os}-{arch}`, and it cannot tell the two builds apart:
the portable launcher and the installed app carry the same shell, patched as bundle type `nsis`.
A portable build that passes no target — every release before this one — therefore probes
`windows-x86_64-nsis`, then the bare `windows-x86_64`.

That makes the conventional layout the dangerous one: with the installer under
`windows-x86_64`, an older portable build downloads an installer and swaps it over its own
launcher. So the two keys such a build can reach both carry the **portable** artefact, and the
installer is published under `windows-x86_64-setup` — a name the plugin never generates. Builds
from this release on pass an explicit target and land on `windows-x86_64-portable` or
`windows-x86_64-setup`, so neither shares a key with the other. The swap also targets the
launcher the operator owns (`PORTABLE_EXECUTABLE_FILE`) rather than the extracted copy the next
launch would discard.

Known edge: an INSTALLED build older than this release probes the bare key and is offered the
portable launcher instead of an installer. It is left running — the launcher extracts beside it
rather than replacing anything — and reinstalling from the setup settles it. That is the safer
side of the trade, since an installer over a portable build destroys the app.

### Fixed — tests wrote into the operator's settings file

`tests/setup.ts` redirected the data directory but not the settings directory, so the
data-folder tests persisted their temporary paths into the real `~/.antidetect/settings.json`.
Harmless to the running app (which reads its own settings directory) and fixed anyway: the
sandbox now covers both.

## [0.6.3] - 2026-09-18

Both defects below shipped in 0.6.2 and are fixed here — the artefacts, not the source.

**The launcher wore the wrong icon.** The portable `.exe` — the file the operator actually
double-clicks — carried the stock NSIS `modern-install.ico`, while the shell inside it carried
the brand mark. `src-tauri/windows/portable.nsi` had no `Icon` directive: MUI2 would have
applied `MUI_ICON`, but `MUI_INSERT` only runs when a page macro is inserted, and this
installer is silent with no pages. The same omission left the NSIS setup and its
`uninstall.exe` on the stock icon, since Tauri's `installerIcon`/`uninstallerIcon` were unset.
Fixed in three places — the template, the build script that substitutes it, and
`tauri.conf.json` — and proven by parsing the PE resource directory: every `RT_ICON` frame in
the rebuilt launcher is byte-identical to a frame of `src-tauri/icons/icon.ico`, and the
extracted icon resource is byte-identical to the whole file.

**"MCP won't turn on" was a stale payload, not a broken server.** The endpoint returned the
bare status object without the `{code,msg,data}` envelope every other route uses, so the panel
— which checks `res.code === 0` — read `undefined` and drew `MCP: Off` beside a server holding
47 tools. The source fix landed after both the 0.6.2 portable (`09:48`) and the operator's
download (`09:00`) were built, so the running app never had it. Verified end-to-end on the
rebuilt payload: `/api/v1/mcp/status` answers the envelope, `POST /mcp/start` brings the child
up on a free loopback port, and the panel renders **`MCP: 47 tools`** instead of Off.

**Auto-update now actually publishes.** The 0.6.2 release carried only the two `.exe` assets:
the signing step failed with `Wrong password for that key`, so it degraded (by design) and
`latest.json` was never published, leaving the updater endpoint pointing at a 404. The
keypair and its password are correct — verified locally with `tauri signer sign` followed by
`cargo run --example verify_minisign`, which prints `SIGNATURE VALID` against the public key
embedded in `tauri.conf.json`. The fix is the CI secret, not the code.

The data directory is also worth knowing about when the panel asks for credentials:
`panel_auth.json` lives in the *data* directory, not in the settings directory that records
that choice, so a password set before the data directory was moved is not the password the
running app checks. `GET /ui/auth-state` answers `hasPassword:false` there, and `POST
/ui/setup` on `http://127.0.0.1:50325/ui` writes a fresh one.

## [0.6.0] - 2026-09-15

Electron is gone for real this release. The version number is 0.6.0 rather than 0.5.0 because
**v0.5.0 was already published** as an Electron build (259 MB artefacts, an electron-updater
`latest.yml`): reusing that tag would have replaced one pipeline's artefacts with another's
under the same name, and left the old updater metadata pointing at files that no longer existed.

### Added — after reviewing the running build

- **Светлая тема.** Полный набор светлых токенов (`:root[data-theme='light']`) — тот же монохромный
  язык, инвертированный: near-white поверхности, near-black текст, полупрозрачно-чёрные оверлеи
  вместо белых. Тема выбирается двухпозиционным переключателем `Light | Dark` в футере сайдбара,
  сохраняется в `localStorage` и применяется **до первой отрисовки**, поэтому у светлого пользователя
  нет тёмной вспышки при старте. При отсутствии выбора учитывается `prefers-color-scheme`.
- **Установка браузерного ядра из приложения.** `POST /api/v1/kernel/install` + `/status` со реальным
  прогрессом в байтах и проверкой SHA-256, плюс кнопка в **Settings → Browser Kernel**. Раньше
  ядро (~425 МБ) тянул только скрипт сборки: поставленная сборка не имела ядра вообще, и **ни один
  профиль не запускался** — без единого объяснения в интерфейсе.
- **Публикация метаданных обновлений.** `scripts/build-updater-manifest.mjs` формирует `latest.json`
  и `.sig`. Скрипт **отказывается** выпускать неподписанный манифест: пустая подпись заставила бы
  апдейтер отвергать все релизы, выглядя при этом настроенным.
- **Уровень привилегий MCP.** `Settings → Security → MCP privileges` (`standard` / `admin`).
  12 деструктивных инструментов (удаление, восстановление, импорт/экспорт) теперь доступны по
  явному согласию оператора; по умолчанию они отклоняются.
- **`--accent-foreground`** — токен для текста на `--accent`-заливке. Инвертируется вместе с темой,
  поэтому подпись и фон не сливаются ни в тёмной, ни в светлой.
- **Выбор папки данных при первом запуске.** Оператор один раз указывает, где хранить профили,
  ядро, расширения и резервные копии — это могут быть десятки гигабайт, и у установленной сборки
  они по умолчанию ложатся в профиль пользователя, нередко на маленький системный диск. Экран
  `FirstRunDataDir` проверяет папку на запись **до** сохранения (через `POST /api/v1/data/first-run/check`),
  поэтому непригодный путь отклоняется сразу с причиной, а не позже как невнятная ошибка БД. Выбор
  хранится на бэкенде (`dataDir` в `settings.json`) и применяется перезапуском: `DATA_DIR`
  вычисляется один раз при старте сервиса, поэтому перемещение живой базы «на ходу» было бы хуже
  перезапуска. Правило «спрашивать или нет» живёт в `config.ts` рядом с порядком разрешения пути
  (`needsFirstRunDataChoice`) и **не срабатывает**, когда путь задан извне: `ANTIDETECT_DATA_DIR`,
  server mode или уже записанный ответ.

### Fixed — найдено запуском, а не чтением диффа

- **Первый клик по «Использовать эту папку» проглатывался.** Клик по кнопке снимает фокус с поля
  пути, blur запускал проверку папки, и кнопка, задизейбленная на время проверки, оказывалась
  выключена ровно в момент клика — требовалось второе нажатие, молча. Кнопка больше не зависит от
  фоновой проверки (сам `confirm` валидирует перед сохранением, а `busy` закрывает двойную отправку).
  Найдено прогоном реального сценария в браузере, а не чтением кода.

- **Оболочка Tauri игнорировала сохранённый выбор папки.** `resolve_data_dir()` в `src-tauri/src/main.rs`
  не читал `settings.json`, поэтому резолвил **дефолтный** путь, экспортировал его как
  `ANTIDETECT_DATA_DIR`, а бэкенд (для которого env-переменная приоритетнее настроек) писал именно
  туда. Выбранная оператором папка оставалась пустой, а профили копились в профиле пользователя.
  Теперь оболочка читает `dataDir` из `settings.json` (с терпимостью к отсутствующему/битому файлу —
  это означает «выбора не было» и приводит к перезапросу, а не к падению). 4 Rust-теста, регресс
  подтверждён мутацией.

- **Промпт первого запуска не появлялся на десктопе вообще.** Оболочка **всегда** экспортирует
  `ANTIDETECT_DATA_DIR`, а правило «переменная задана извне → не спрашивать» не различало внешний пин
  (CI, тесты, скрипты) и собственный экспорт оболочки. На чистой установке `needed` было `false` —
  фича вышла бы мёртвой. Оболочка помечает свой экспорт (`ANTIDETECT_DATA_DIR_FROM_SHELL=1`), и только
  внешний пин подавляет промпт.

- **Признак «данные уже есть» был всегда истинным.** `config.ts` создаёт `profiles/`, `chromium/` и
  пустую БД **при импорте**, поэтому проверка их существования не срабатывала никогда. Заменено на
  непустую `profiles/` — единственный сигнал, который создаёт реальное использование. Пустой
  `chromium/fingerprint-chromium` тоже не годится: dev-чекаут оставляет там симлинк, который глушил бы
  промпт. Оба случая покрыты тестами и проверены мутацией.

- **Проверка папки создавала её молча.** `isUsableDataDir` вызывал `mkdirSync`, а проверка идёт на
  каждый blur, пока оператор ещё печатает путь. Набор `…/settings.json` создавал **каталог** с именем
  файла настроек — после чего настройки не писались вообще, включая запись самого выбора. Проверка
  теперь чистая (`create: false`): существование и запись оцениваются без создания; папка создаётся
  только при сохранении. Отдельно добавлен запрет на путь, совпадающий с файлом настроек.

- **Сохранение выбора рапортовало успех, когда запись провалилась.** `writeSettings` глушит ошибки по
  замыслу (настройки best-effort), но выбор папки — не best-effort: оператор получал `ok: true` и после
  перезапуска оказывался в дефолтной папке, что неотличимо от игнорирования выбора. Теперь
  `setFirstRunDataChoice` возвращает результат записи, и `POST /first-run` отвечает ошибкой.

- **Ядро не могло быть установлено в поставленной сборке** (см. выше): `ensureKernel()` был
  реализован полностью и **не вызывался нигде**.
- **12 привилегированных MCP-инструментов были недостижимы в принципе.** `McpServer.defaultScope`
  был жёстко `'standard'`, а `ANTIDETECT_MCP_SCOPE` читался **только в stdio-ветке** — то есть по
  HTTP, единственному транспорту, которым пользуется приложение, настройка не действовала.
- **Хардкод-цвета ломали светлую тему:** `#fafafa` в календаре и `#a1a1aa` в настройках безопасности
  (оба невидимы на светлом фоне), `#fff` на акцентной заливке. Переведены на токены. Значения
  `#71717a`/`#555555` **оставлены** — это данные для `<input type="color">`, а не оформление.
- **`dist-release/`** (генерируемые `latest.json` и `.sig`) добавлен в `.gitignore`.
- Спецификация `screen-capture-protection` описывала **Electron API**, хотя код давно на Rust/Tauri;
  приведена к реальности, вместе с устаревшими комментариями в `screenProtection.ts`.

### Changed
- **Полное удаление Electron**: Electron окончательно исключён из кодовой базы (R05 закрыт).
  - Удалены зависимости `electron`, `electron-builder`, `electron-updater`.
  - Удалены директория `electron/` (`main.ts`, `preload.ts`), `build/` (конфигурация entitlements и иконки electron-builder), `scripts/afterPack-adhoc-sign.cjs`.
  - Удалены секция `build` и поле `main` из `package.json`, а также устаревшие скрипты сборки Electron (`dist:*`, `electron:dev` и др.).
  - Скрипт `dev` теперь запускает оболочку Tauri в режиме разработки (`npm run build && npm run vendor:node && tauri dev`).
  - CI-пайплайн переведён на Tauri: задача сборки и публикации релизов теперь собирает артефакты Tauri.
- **Десктопный билд на базе Tauri v2**:
  - Основным и единственным десктопным приложением теперь является легковесная оболочка Tauri v2 (`src-tauri/`), спавнящая Node-бэкенд (`dist/src/main/index.js`) в качестве sidecar.
  - **Замеренные артефакты (Windows x64)**: single-file portable — ~49.5 МБ, установщик (NSIS) — ~33.1 МБ (для сравнения: прежняя сборка на Electron весила ~248 МБ).
  - **Платформенная поддержка**: Windows является единственной платформой, для которой выполняются сборка и тестирование. macOS и Linux присутствуют исключительно на уровне конфигурации; артефакты под них не публикуются.
  - Защита от захвата экрана (`set_content_protected`) кроссплатформенна, однако отслеживание состояния блокировки сессии и простоя (idle/session-lock) реализовано эксклюзивно для Windows через Win32 API.
  - Браузерное ядро **не бандлится** в релизные артефакты и загружается при первом запуске (R17i).
- **Сигнал упакованного приложения (Security-Critical)**:
  - Ранее бэкенд проверял запуск в упакованном виде через `require('electron').app.isPackaged` для запрета флага `--allow-unsigned-dev`.
  - После удаления Electron шелл Tauri в релизных сборках (`!cfg!(debug_assertions)`) передаёт переменные окружения `ANTIDETECT_PACKAGED=1` и `NODE_ENV=production`.
  - Бэкенд определяет статус упаковки по `process.env.ANTIDETECT_PACKAGED === '1' || process.env.NODE_ENV === 'production'`, сохраняя строгий запрет `--allow-unsigned-dev` в продакшен-сборках.
### Fixed (найдено при проверке работоспособности, а не чтением диффа)
- **Sidecar запускал не тот вход.** Оболочка спавнила `dist/electron/main.js` (Electron-энтри), который под
  обычным `node` падает на `electron-updater`, и ждала строку `"Server running at"`, которую бэкенд никогда не
  печатал. Теперь спавнится `dist/src/main/index.js`, а готовность определяется по реальной строке
  `[antidetect] Local API listening on` или по занятому порту.
- **Порт игнорировался.** Оболочка жёстко использовала `50325`, а sidecar передавал `PORT`, тогда как бэкенд
  читает `API_PORT` (`src/main/config.ts:110`). Переопределение порта молча не действовало.
  Теперь оболочка читает `API_PORT` из окружения и передаёт именно его.
- **Окно создавалось дважды.** Окно объявлялось и в `tauri.conf.json`, и в `main.rs`, из-за чего приложение
  падало с `WebviewLabelAlreadyExists("main")`. Единственный владелец окна — `main.rs`, потому что только там
  можно повесить `.initialization_script(bridge.js)`.
- **Мост не совпадал с тем, что вызывает рендерер.** `bridge.js` отдавал `minimizeWindow`/`checkForUpdates`
  в корне вместо `window.minimize()`/`update.check()`. Рендерер использует опциональную цепочку, поэтому
  отсутствующие методы отказывали **молча** — кнопки окна и вся страница Settings были бы мертвы.
  Форма приведена к фактическим местам вызова; добавлен тест формы моста.
- **Обновления не устанавливались.** `install()` никогда не вызывал `Update::install(&bytes)` — проверенные
  байты отбрасывались, а заглушка `portable_self_update` лишь печатала путь и возвращала `Ok`.
- **Проверка обновлений отказывала всегда.** `resources/release-keyring.json` отсутствовал, поэтому keyring
  резолвился пустым и `verify_artifact` отвергал **любое** обновление. Keyring добавлен, включён в
  `bundle.resources`, и покрыт Rust-тестом на поставку и загрузку.
- **`process.resourcesPath`** (Electron-глобал) убран из поиска ядра и chromedriver — заменён на
  `ANTIDETECT_TARGET_RESOURCES_DIR`.
- **`dist/node_modules` собирались вручную** и не воспроизводились на чистом чекауте; теперь их создаёт
  `npm run copy:prod-deps`, встроенный в `tauri:build`.

### Честный статус платформ и верификации
- Windows является **единственной собранной и верифицированной платформой**.
- macOS и Linux поставляются **только в виде конфигурации** (`src-tauri/tauri.conf.json`), готовые артефакты под них в этом релизе не публикуются.
- Защита от захвата экрана (`set_content_protected`) реализована кроссплатформенно, но автоблокировка по бездействию (measured-idle) и блокировка сессии (session-lock) в этой версии активны **только под Windows** (через Win32 API).
- Браузерное ядро (fingerprint-chromium) не бандлится в установщик и скачивается при первом старте.
- Сборка для macOS использует ad-hoc подпись (`bundle.macos.signingIdentity = "-"`), у проекта нет Apple Developer account, поэтому при первом запуске требуется однократное снятие карантина Gatekeeper (`xattr -dr com.apple.quarantine`).

All notable changes are documented here. Releases are published on
[GitHub Releases](https://github.com/wdnameless/antidetect-browser/releases).

## Unreleased — Shell typography, MCP surface, responsive Automation

The interface was asked to look like the ShardX reference — «шрифты, разделы, меню и MCP,
documentation and automation api» — and the Automation tab was called out as having
«нет адаптивности».

**Typography.** `--font-sans` had claimed `'Inter'` while no font file existed in the
repository, so every screen rendered Segoe UI. Inter is now vendored as two woff2 files
(67KB, latin + cyrillic — the UI ships Russian strings) and loads with no network request.
Google serves a *variable* Inter, so the four weight URLs are byte-identical; one face per
subset covers 100–900.

**MCP.** The server was already fully implemented — 47 tools, two tiers, stdio and loopback
HTTP, RBAC, audit log — and completely invisible: no build script, no endpoint, no UI. It
now builds (`npm run build:mcp`), runs as a tracked child process, and is driven from a
sidebar footer panel with live status, start/stop and a copyable client config. The copied
config was initially wrong in both variants (`/sse` does not exist; the stdio path did not
exist either) and is now verified against the live server.

**Footer.** An Automation API panel with the real loopback origin and a copyable curl (key
masked on screen, full value still copied), a Documentation link, and a version pill that
says "Not checked" rather than claiming "up to date".

**Automation responsiveness.** The renderer had zero `@media` rules and hardcoded panel
widths. Panels now respond through tokens: below 1100px the inspector becomes an overlay
drawer with Esc-to-close and focus return, and the palette collapses to a legible rail.

Defects found by looking at the rendered result rather than the diff: all twelve
`.footer-panel-*` classes were undefined so the panels rendered unstyled; four referenced
design tokens were never declared; a hardcoded `?? 47` tool count would have claimed a
healthy server while the endpoint was unreachable; the palette rail printed
`label.slice(0, 2)` — "Na", "Cl", "Ty" — which is a truncated word, not a label.

Verified in the running app: Inter reported loaded, footer reading `STATUS RUNNING` /
`47 (T1: 35 / T2: 12)` with the live endpoint, `200 /v1/mcp/start`, no horizontal overflow
at 1000/1250/1600px, and a blind acceptance pass with all nine audited requirements green.

## v0.4.0 - Density redesign, the brand mark, and the first shipped build since 0.2.33

The interface was called «слишком нагромажденный» with «много визуальных багов», against the
ShardX reference, with one hard constraint: «не урезать функционал».

Measuring the running app first changed the plan. The renderer already painted **zero
chromatic colours across 19 values**, so colour was never the clutter. What was actually
wrong, and what changed:

| | before | after |
|---|---|---|
| Profile rows | 100px, two storeys | **52px, one line** |
| Sidebar items | 15 flat | **7 destinations + sub-tabs** |
| Full-perimeter bordered boxes | 55 | surfaces + dividers |
| `!important` | 2 | **0** |
| `:focus-visible` rules | 0 | 1 |
| Spacing scale | none, every gap a literal px | `--space-1…7` |

- **Rows** use a frozen `.row-dense` contract across six table pages. Density comes from
  row height and padding — the tables stay real `<table>` elements so column alignment
  survives (Proxies is a multi-column grid). Actions hide on `opacity` and reveal on hover
  or keyboard focus; the batch checkbox is deliberately never hover-gated, because a
  checkbox that only appears on hover cannot be used by keyboard or touch.
- **Navigation** keeps all 15 pages reachable via a parent/child model. `NAV` was not
  shrunk: `tests/unit/shellGroups.test.ts` guards reachability (it exists because `scripts`
  was once rendered but unclickable) and was adapted rather than deleted.
- **The brand icon is now the user's mark** — the black visor mask, not the indigo shield
  `#6366f1` that `predist` was overwriting it with. Applied to the `.exe`, tray, favicon,
  `.ico`/`.icns` and the sidebar, from a single geometry source.
- **Fixed** while verifying: the Vite dev template was mistaken for built output, serving a
  page that referenced `/src/main.tsx` and yielded a blank UI; `EmptyState.description` was
  typed required while callers passed undefined; long profile names wrapped onto a second
  line, breaking the one-line row contract.

Verified on the running app, not only in tests: 7 nav items, sub-tabs switch, measured row
height exactly 52px with a single distinct height across 71 rows, actions at `opacity: 0`,
chromatic colour count 0, and a blind acceptance pass over all 11 criteria.

### Not in this release

- **Linux and macOS builds.** The build scripts are Windows-hardcoded in three places —
  `ensure-chromedriver.mjs` fetches `win64/…`, `ensure-kernel.mjs` pins the
  `windows_x64` archive and its SHA256, and `config.ts` searches for `chrome.exe`. Upstream
  publishes Linux and macOS kernels, so this is fixable, but it cannot be verified from
  this workspace. The release workflow builds Windows only and records the gap rather than
  shipping an unverified platform binary.
- **Signed macOS builds** — still no Apple Developer account; the ad-hoc signing path is in
  place for when a macOS build is produced.

### Fixed in the release pipeline itself

No tag had ever produced a release. The workflow gated its release job on
`refs/tags/v*` while declaring only `push: branches: [main]` as a trigger, so the condition
could never be true — v0.3.0 through v0.3.4 were documented in this changelog and never
shipped. Tag pushes now start the workflow. The build step also passes `--publish never`,
because electron-builder auto-detects CI, tries to publish on its own, and aborts the build
when no `GH_TOKEN` is present.

## v0.3.4 - SDKs, Google Drive, macOS, Tauri shell

The open items from the parity program, closed. Every claim below was verified by
running the code, not by reading the diff — and three of them were wrong until it was.

### Standalone SDKs (Node, Python, Rust)
- **Node**: `ensureEngine()` fetches the patched Chromium, verifies SHA256, extracts and
  caches it; `launchStandaloneProfile()` spawns an isolated profile and returns a CDP
  endpoint. **Proven end-to-end** — a live launch an independent `puppeteer-core` client
  connects to and drives.
- **Python**: the same public surface (`ensure_engine`, `launch_standalone_profile`,
  `build_standalone_args`) with the same caching and digest refusal.
- **Rust**: `packages/sdk-rust` was a bare `cargo new` stub whose only function was
  `add(a, b)`. Replaced with a real crate — streaming SHA-256 verification that deletes
  a mismatched payload, isolation-flag launch, and `DevToolsActivePort` polling. 17
  tests, all offline.
- **Both existing SDKs shipped invented values.** The engine repository was
  `nulltrace/antidetect-chromium`, which does not exist, and all three SHA256 digests
  were fabricated — so any download would have 404'd or failed verification. Pointed at
  the real upstream with the digests the application already pins.

### Google Drive sync
- Operator-supplied OAuth client; we ship none. Credentials and the refresh token go
  through the secret store — never `settings.json`, never a response, never a log.
- Folder locate-or-create with the id persisted so a second machine reuses it; push and
  pull of profiles, scripts and settings; a pull refuses to overwrite local data without
  an explicit conflict rule. The existing self-hosted sync is untouched.
- **Six real defects** were exposed by making the tests exercise the real API rather
  than the API the agent assumed: `listProfiles()` called without its required paging
  arguments; a `SELECT` naming three columns the `scripts` table does not have; profile
  rows read as `id`/`updated_at` from a projection that has `user_id` and no timestamp;
  `updateProfile()` handed a `geolocation` field it does not accept; three imports
  pulled from the wrong module plus one import of a function that does not exist; and a
  `state.authenticated` read where the field is `authorized`.

### macOS
- `build/entitlements.mac.plist` with the four entitlements a frameless Electron app
  needs to spawn its browser child under the hardened runtime, each one justified in a
  comment.
- The build stays **unsigned** — there is no Apple Developer account — and the README
  says so, together with the fact that macOS is the one platform that cannot be a single
  file.

### Tauri shell
- A thin Rust shell over the **already working** served interface: it opens a webview on
  the backend and starts/awaits/stops the Node backend as a sidecar. It reimplements
  nothing, and the window points at the served UI rather than bundling a second renderer.
- Sidecar lifecycle is isolated and tested in Rust: readiness observed by polling rather
  than by a fixed delay, a legible failure when the backend dies, and teardown on every
  exit path so no orphaned process is left holding the port.
- **Recorded plainly:** this does **not** remove installation. A Tauri app is still an
  installed `.app`/`.dmg`/`.msi`. What removed installation was serving the renderer over
  HTTP, and that shipped two releases ago. The shell is a smaller native alternative,
  and it is additive — Electron remains the supported desktop build until this is proven
  on all three platforms.

## v0.3.3 - NullTrace noir: pages swept onto tokens

Every page and component now resolves through the token layer. The renderer contains
**zero chrome colour literals and zero orphan token references**, enforced by a test
that reads every source file rather than only the stylesheet.

| File | before | after |
|---|---|---|
| `pages/FlowCanvas.tsx` | 192 literals | 0 |
| `pages/Email.tsx` | 51 literals, 20 orphan `var(--x, #hex)` | 0 |
| `components/FleetPanel.tsx` | 18 literals | 0 |
| `pages/Profiles.tsx` | 8 | 0 |
| `pages/Calendar.tsx` | 8 | 0 |
| `pages/Diagnostics.tsx` | 5 + 1 orphan | 0 |
| `pages/SecuritySettings.tsx`, `SyncSettings.tsx`, `Extensions.tsx`, `LoginScreen.tsx` | 8 + 2 orphans | 0 |

- **Flow Canvas** was the bulk of it, and most of its 192 were neutral greys that only
  needed to become tokens. The ~25 that carried meaning were handled differently: the
  validation indicator and the live-run state kept their boolean branches and changed
  only their appearance; SVG edge markers, whose presentation attributes cannot read a
  CSS variable, were switched to token-driven `style` values.
- **Meaning survived.** Where colour used to carry it — valid vs invalid, running vs
  stopped, healthy/warn/failed on Diagnostics, node kinds on the canvas — the states
  remain distinguishable by background step, weight, border style or glyph. A change
  that made them indistinguishable would have been a regression, not a redesign.
- **The orphan dialect is gone.** `var(--bg-secondary, #1e1e24)`-style references to
  tokens that never existed silently rendered the fallback and defeated any restyle.
  None remain anywhere in the renderer.
- **Operator data colours are untouched.** Profile and tag colours the operator chose
  are data, not chrome; the guard exempts them by identifying the palette's source
  rather than by a filename allowlist that would rot.

### Also fixed
- **Duplicate page titles**: `Proxies` and `Extensions` rendered their own `h2` while
  the shell already rendered one, so both pages showed the title twice.
- **One shared empty state** (`components/EmptyState.tsx`), adopted by Profiles,
  Proxies and Extensions, replacing three inline variants that each looked slightly
  different.
- **`LoginScreen`** still used the pre-token dialect and a red error tint; it now uses
  tokens, and the sign-in failure is distinguished by a stronger background step and a
  left rule rather than by hue.

## v0.3.2 - NullTrace noir: grouped shell, no boxes, frameless window

The interface is rebuilt in ShardX's shape and strictly monochrome. Verified by
looking at it in a browser, not by reading the diff.

### Frames removed
- **Full-perimeter borders and elevation come off** containers, controls, chips and
  row-action buttons: `.table-container`, `.panel`, inputs, buttons, selects, search,
  segmented control, badges, platform tags, group/tag/proxy chips and the per-row
  icon buttons. Surfaces are separated by a background step and spacing instead.
- **Hairline dividers are kept** — table rows, section breaks, modal head/foot,
  sidebar edges. That is the line between "no boxes" and "no structure": losing them
  would run rows and sections together. A test asserts at least four survive.
- The modal keeps its shadow. It is an overlay, not an inline container, and the
  shadow is what tells the operator it sits above the page.

### Grouped navigation
- Navigation is grouped under labelled sections, as in the reference:
  **WORKSPACE** (Profiles, Groups, Proxies, Devices, Extensions, Flow Canvas,
  Automation) · **LIBRARY** (Email, Calendar, Catalog, Teams) ·
  **SYSTEM** (Diagnostics, Trash, Cloud Sync, Settings).
- **`scripts` was unreachable.** It existed in the `Page` union and rendered, but was
  missing from the navigation, so no click could get there. Restored, and a test now
  asserts every page in the union is reachable — the class of bug rather than the one
  instance.
- Collapse (Ctrl/Cmd+B, `sidebar.collapsed`) still works; group labels hide when
  collapsed.

### Frameless window
- The native title bar and the `File/Edit/View/Window` menu are gone. The app supplies
  a draggable header (`-webkit-app-region: drag`, with interactive children opting out)
  and its own minimise / maximise / close controls.
- The controls render **only** when the Electron bridge exists. A browser-served client
  has no such bridge, so it gets no dead buttons.
- Tray behaviour and close-to-tray are preserved — an unmovable or unclosable window
  would have been a hard failure, so that path was checked, not assumed.

### Monochrome
- The token layer gained surface steps (`--surface-1/2/3`), `--divider`, control
  backgrounds and a rationalised radius scale, replacing nine ad-hoc radius values.
- **Zero hue remains.** The last 14 saturated literals, all in the preflight/proxy
  blocks, are gone; `FleetPanel`'s `STATUS_COLORS` hex map became tokens.
- States that were told apart by colour now use weight, background step and shape, so
  they survive without hue.
- Operator-chosen data colours (profile/tag pickers) are untouched — they are data,
  not chrome.

### Guards
`tests/unit/noirTokens.test.ts` and `tests/unit/shellGroups.test.ts` make the direction
enforceable: no hue anywhere in chrome, no `var()` referencing an undefined token (the
old dialect silently rendered its fallback), no box border or elevation on inline
containers, structural dividers still present, every navigable page reachable, and the
window-control bridge detected rather than assumed.

## v0.3.1 - NullTrace Portable: no installer, one file

The product ships as a file you run, not an installer. Verified end-to-end: the
built portable binary starts, serves the UI, and writes its data beside itself.

### Installer-free artefacts
- **Windows**: electron-builder `portable` target — a single self-extracting
  `.exe` (`NullTrace-<version>-portable-win-x64.exe`, **102 MB**). The `nsis`
  installer target is removed, so no installer is produced at all.
- **Linux**: `AppImage` — `NullTrace-<version>-portable-linux-x64.AppImage`.
- **macOS**: `dmg` for arm64. Stated plainly: macOS is **not** single-file, and
  because there is no Apple Developer account the build is unsigned, so opening it
  needs the documented quarantine step. This is the same limitation the reference
  product ships with.
- `appId` deliberately unchanged (`com.antidetect.browser`) so existing installs
  can move to the portable artefact.

### The kernel is downloaded, not bundled
- The patched Chromium (425 MB) is no longer baked into the artefact through
  `extraResources`. It is acquired on first use — which is why the Windows file
  dropped from ~600 MB to **102 MB**.
- **Every download is verified before use.** The three platform assets are pinned
  in source with their published SHA256 digests, and a digest mismatch, a corrupted
  payload or a missing release fails closed: nothing usable-looking is left behind
  and a retry needs no manual cleanup. Covered by tests, including a deliberately
  corrupted byte and a wrong expected digest.
- Acquisition comes from the upstream GitHub Releases, so no new hosting account
  was needed. The pinned digests carry a comment recording that they are external
  and must be re-pinned when the kernel version moves.

### Portable data mode
- On a first portable launch the operator chooses whether data lives beside the
  executable or in the system location, and the choice is remembered.
- The portable path is derived from `PORTABLE_EXECUTABLE_DIR` — the directory the
  user actually ran the file from — **not** an absolute path captured at first run.
  That is what makes the folder relocatable: move it to another drive or machine and
  the profiles come with it. Covered by a test that resolves two different
  executable locations to their own data directories.
- An ordinary non-portable launch is never asked the question.
- Storage is untouched (`safeStorage`/DPAPI), so credentials created before this
  change still decrypt.

### CI
The release job is now a three-platform matrix — `windows-latest`,
`ubuntu-latest`, `macos-14` — each building its own artefact, running typecheck and
the unit suite on its own runner so a platform-specific break is caught rather than
shipped. No signing credentials are required or expected.

### Fixed
`package.json` had a `// appId` annotation **inside** the `build` block.
electron-builder rejects unknown properties outright, so every build failed with
`Invalid configuration object`. The note now lives beside `build`, and a test
asserts no comment keys exist inside it.

## v0.3.0 - NullTrace: web application, rebrand, monochrome noir

The product is renamed **NullTrace** and now runs as a **web application**: it opens
in any browser on any operating system with no installer and no code signing.
Taglines: "Zero footprint, infinite scale." / "Leave nothing behind."

### Web platform
- **The interface is served over HTTP by the product's own server.** Express now
  serves the built renderer alongside the existing panel, before the auth middleware
  so the shell and its assets load unauthenticated while every data and action
  endpoint stays behind authentication. An SPA fallback serves the shell for
  client-side routes; API paths are deliberately excluded so a missing endpoint still
  returns JSON rather than HTML.
- **The API base is origin-relative.** A page served from the API's own origin now
  calls that origin instead of the hardcoded `127.0.0.1:50325`, so a non-default port
  works. The Electron path and the explicit override both still work.
- **Login screen** wired to the existing panel auth (`/ui/auth-state`,
  `/ui/setup` one-time, `/ui/login`). The returned token is stored where the existing
  Bearer path already looked for it — no new server-side auth was added.
- Verified in a real browser: the shell renders, the brand block reads NullTrace,
  navigation works, login completes, and the favicon is served.

### Identity
- Renamed on every user-visible surface: window and tray, page title, brand block,
  loading state, both `en` and `ru` localisation, the panel HTML, README, and the
  packaging `productName`/`artifactName`/description.
- Renamed on artefacts that leave the machine: the cookie-export header, the profile
  CSV filename, and the injected bookmark node.
- **Deliberately NOT renamed**, because their values carry cryptographic meaning or
  locate on-disk state — changing any of them would silently re-seed every profile's
  fingerprint, invalidate signed releases, or orphan a user's existing data:
  `HMAC_SECRET`, `SIGNING_DOMAIN_PREFIX`, the database and data-directory names, the
  backup filenames, the `ANTIDETECT_*` environment variables, the instance-lock
  executable name, the preload bridge name, and `build.appId`. Each site documents
  why, and `tests/unit/brandIdentity.test.ts` hardcodes the expected values so a
  future rename cannot quietly complete itself.

### Icon
- One geometry definition, in `scripts/generate-icons.py`, produces the SVG master
  **and** every raster: PNG 1024→16, a multi-size `.ico`, an `.icns`, and the web
  favicon. Generated from the same coordinates, so they cannot drift.
- The mark is a traced black silhouette on a white disc — two ears with a notch, a
  horizontal band with eye cut-outs and a dot, a right-pointing horn, a torn lower-left
  edge, and stamped grain. Monochrome, matching the noir direction.
- Replaces the previous indigo shield favicon, which contradicted the palette.

### Program
OpenSpec `nulltrace-web-rebrand` (manifest, proposal, tasks, three capability specs).
Design-system work — the neutral token layer, the ShardX-shaped grouped shell, and
the page sweep — is specified and scheduled as the next wave.

## v0.2.36 - Competitive parity wave 2: automation, persona, MCP surface

Automation parity with ShardX (OpenSpec `competitive-parity-2026-q3`, wave 2).

- **Global keys usable from a no-code flow.** Earlier claim that global variables
  were missing was **wrong and withdrawn** — they exist end to end (`global_keys`
  table, AES-256-GCM store, `/api/v1/keys`, "Global Keys" tab, `app.keys.get/set`
  with write-back). The real gap was that `compileFlowToScript` never referenced
  them. New flow nodes `key_read` and `key_write` compile onto the existing sandbox
  surface; a missing key fails the run instead of substituting an empty value.
- **Form-filling helper.** `src/main/motion/persona.ts` generates a coherent,
  deterministic person per profile (name, address, region-consistent postcode,
  nationally-shaped phone, name-derived email, Luhn-valid card with a future expiry,
  plausible date of birth) from HMAC-SHA256 domain separation, like the motor seed.
  Filling types through the Motion input path as real key events — never by
  assigning `element.value`. New flow node `fill_form`, API endpoints
  `GET /api/v1/persona` and `POST /api/v1/persona/fill`.
- **MCP tool surface 17 → 47.** Twenty-three new default tools and seven new gated
  ones cover proxies, extensions, flows, task groups, trash, cookies, triggers,
  tags and batch operations — registered through the existing triple
  (manifest + dispatch case + tier set), with the prohibited set, replay defence
  and hash-chained audit log unchanged.
- **FIXED — script engine was completely broken.** `WORKER_SOURCE` had an unclosed
  `http: {` block, which swallowed `app.log` into it and left the worker source
  syntactically invalid. **Every** script and flow run failed with a bare
  `worker error: Unexpected token ';'` and zero log output. Introduced by a wave-2
  edit; caught by an end-to-end probe rather than by the suite, which is why two
  new hygiene guards now parse the worker template and assert the sandbox exposes
  every `app.*` member that compiled nodes call.
- **FIXED — `fill_form` fabricated success.** The node originally fell back to
  logging "Simulated form fill" and returning a `filled` array when the persona
  surface was absent. It now fails loudly, and `app.persona` was added to the
  sandbox so the real path exists.
- **FIXED — persona coherence bugs.** UK postcodes did not match their region and
  UK phone numbers had no separator; US/DE/FR name pools were small enough that
  distinct profile seeds collided on the same person.

## v0.2.35 - Competitive parity wave 1: verified defects closed, data formats added

Gap analysis against ProxyShard/ShardX and Afina.io (2026-09-13) found four shipped
defects — capabilities that were declared or implemented but wired to nothing — and
three operator data formats Afina has and we did not. This release closes them.
OpenSpec program: `competitive-parity-2026-q3` (children `add-font-pinning`,
`add-mobile-sensors`, `add-flow-module-execution`, plus the pre-existing
`add-cookie-sqlite-io`, `add-xlsx-io`, `add-email-manager`, `add-telegram-bot`).

- **Font pinning (defect).** `StealthOptions.fontList` was declared and read by
  nobody, so a page enumerating fonts still saw the host machine's set. Now resolves
  each profile's inventory from its fingerprint family and masks
  `document.fonts.check`, `FontFaceSet.prototype.check`, `measureText`, and the
  sized-element `offsetWidth`/`offsetHeight` probe (`TODO(engine-parity: fonts)`).
  `window.queryLocalFonts` stays present and rejects with a `NotAllowedError`-shaped
  error; `navigator.fonts` is deliberately NOT fabricated (stock Chrome has no such
  object, so adding one would itself be a tell).
- **Mobile motion sensors (defect).** A profile claiming a phone exposed no
  `DeviceMotion`/`DeviceOrientation`/`Sensor` surface at all — one probe separated it
  from a real handset. Now `DeviceMotionEvent`, `DeviceOrientationEvent`, the
  `Sensor` family (`Accelerometer`, `Gyroscope`, `Magnetometer`,
  `LinearAccelerationSensor`, `GravitySensor`), the sensor permission answers, and
  `screen.orientation` all derive from a per-seed profile. Desktop profiles are
  untouched (`TODO(engine-parity: sensors)`).
- **Flow `module` node (defect).** The compiler emitted
  `{ success: true, moduleId, args }` and invoked nothing, so a flow using it
  reported success and did no work. It now compiles to a real
  `app.callModule(id, args)` against the script-engine sandbox, with the call
  counted against the existing HTTP budget, `[FLOW_NODE_ERROR]` on failure, and
  save-time validation rejecting an unknown module id.
- **Telegram bot (defect).** `src/main/telegram/bot.ts` was 296 fully-written lines
  imported by no file. Now constructed at service start, `/start` `/stop` `/status`
  `/list` bound to the real profile and launcher APIs, notifications fired from the
  existing `onProfileStatusChange` hook, polling stopped on shutdown, and a Settings
  section for the token (masked — the raw token is never returned) and chat ids.
- **Cookie SQLite import/export.** Chromium `Cookies` databases in the `v10` format
  (DPAPI-unwrapped key on Windows, AES-256-GCM values), read through the existing
  sql.js module and merged with `INSERT OR REPLACE` on `(name, host_key, path)`.
  Writes to a running profile are refused rather than risking WAL corruption.
- **XLSX import/export** for profiles, via a dependency-free single-sheet OOXML
  reader/writer with byte-stable output and a strict reader.
- **IMAP email manager.** A 4-command client (LOGIN, SELECT, FETCH ENVELOPE, FETCH
  BODY) over TLS with an injectable socket seam, a verification-code extractor, and
  vault-backed account storage with masked secrets.
- **Fixed: import cycle** `migration -> derivation -> catalog -> macosFamilies ->
  migration` left `MAC_MODERN_FONTS` uninitialised depending on import order. `crc32`
  moved to a leaf module (`fingerprints/crc32.ts`); `derivation` re-exports it.
- **Test hygiene guards** (`tests/unit/hygiene.test.ts`): fails the build on a
  declared-but-unconsumed stealth option, an unimported service module, an unmounted
  route module, TypeScript-only syntax inside the browser-injected stealth template,
  and a test sandbox that mis-models `window === globalThis`.

## v0.2.34 - ShardX/Afina parity program: human input, engine surfaces, fleet UX

Parity program vs ProxyShard/ShardX and Afina.io (10 OpenSpec children).

- **Motion CDP domain** (hidden, engine-parity contract stable): Fitts's-law
  pointer glide with per-profile motor seeds, per-key typing with seeded pace
  and optional typo+backspace model. Surfaces: MCP tools
  `browser.human_type` / `browser.human_click`, flow nodes `human_click` /
  `human_type` in the no-code canvas, Node/Python SDK method surface.
- **Engine surfaces (JS-interim, `TODO(engine-parity)` marked)**:
  `navigator.gpu.requestAdapter` resolves the profile family's GPU (host GPU
  never surfaces; WebGPU-less families resolve `undefined` like real Linux
  Chrome); `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable`
  answers the claimed-device matrix, not the host.
- **Web Store extension installer**: install by URL or 32-char ID — CRX fetch
  via the versioned update protocol, signature verification, localized
  manifest unpack, idempotent registration (`POST /api/v1/extension/install`).
- **Bulk fingerprint rotation**: `POST /api/v1/browser-profile/bulk-fingerprint`
  with `rotate` (weighted coherent family resample, seed-hint replayable) and
  `patch` modes; per-item report, coherence-gated persistence, running
  profiles fail closed. Bulk bar action in Profiles UI.
- **Fingerprint catalog v2**: deterministic `catalog-v2.json` bundle (46
  families, sha256-stable), AudioContext/OS-audio coherence rule
  (macOS 48000/44100, Win/Linux 44100/48000 PulseAudio-realistic), coherent
  archetype sampling at profile creation (new profiles derive every hardware
  surface from one weighted family + seed).
- **Screen-capture protection + auto-lock**: `setContentProtection` on app
  windows (WDA_EXCLUDEFROMCAPTURE), idle auto-lock with lock-screen/suspend
  engagement; Settings → Security.
- **Movable data root**: copy-verify-swap relocation with progress/cancel
  (`/api/v1/settings/data-root/move*`), SQLite-image integrity checks,
  absolute-path rewrite; Settings → Data Folder.
- **Task Calendar**: month-grid view over cron triggers and task-group time
  windows (client-side cron projection); sidebar entry.
- **Profile window badge**: per-profile color (3/6-digit hex), badge initials,
  `[XX] ` window title prefix at launch via CDP, color dot in the profiles
  table and picker in the editor.
- **Extra launch args**: per-profile Chromium switches appended LAST
  (last-wins override), save-time denylist (`--fingerprint*`,
  `--remote-debugging*`, `--user-data-dir`, `--proxy-server`,
  `--load-extension`, `--disable-extensions`).
- **Folder bookmarks**: folder-scoped shared bookmarks merged into every member
  profile's Chromium `Bookmarks` at launch (managed node only; user data
  byte-preserved; malformed files quarantined as `.bak`).
- Engine-level hardening change extended with WebGPU/WebAuthn/native-Motion
  patch rows (private-engine chain prerequisite unchanged).

## v0.2.30 - Cloud Sync tab: connect, deploy, sync from the desktop app

- **New "Cloud Sync" tab**: connect the desktop app to your self-hosted
  server instance (URL/IP → sign in or one-time account setup).
- **One-command deploy**: copy a bootstrap PowerShell command that installs
  Node, WireGuard (10.8.0.1 + N peers), builds the app and registers an
  auto-start service on any Windows dedicated machine (`deploy/bootstrap.ps1`).
- **Profile sync**: push local profiles to the server and pull server profiles
  back (bundle export/import over the cloud bridge; running profiles skipped).
- **Devices list**: recent panel logins (time, IP, user-agent) from the server.
- Server-side: login sessions are recorded (`data\panel_sessions.json`) and
  exposed via `GET /ui/sessions`; cloud bridge endpoints under
  `/api/v1/cloud/*` keep remote credentials in the main process.

## v0.2.29 - Server deployment: remote access, web panel + screencast viewer

- **Server mode** (`ANTIDETECT_SERVER_MODE=1`): trusted Host whitelist behind a
  reverse proxy, per-request file log, CORS disabled.
- **CDP tunnel**: `/cdp/:sessionId/*` exposes each profile's loopback DevTools
  endpoint through the single API port (HTTP streaming + raw WS pipe); random
  debug ports stay closed. `browser/start` rewrites `ws.puppeteer` to the
  tunneled URL for remote clients — Puppeteer/Playwright connect unchanged.
- **Web panel** at `/ui`: login with API key, profile list, start/stop/create,
- **Screencast viewer** (`/cdp-view/:id`): streams the running browser into the
  panel via CDP `Page.startScreencast` with full mouse/keyboard control —
  use profiles from any device while Chromium runs on the server.
- **Deploy kit**: Traefik docker-compose bound to the WireGuard interface,
  guides `docs/SERVER_DEPLOY.md` (EN) / `.ru.md` (RU): WireGuard, NSSM
  autostart, RDP session keep-alive, firewall, profile migration.

## v0.2.21 - Premium monochrome redesign & two-pane Settings

- **Monochrome design system**: black/white/gray palette (Vercel/Linear-style) -
  white primary buttons with dark text, gray outlines, monochrome status badges
  and action buttons. All blue/purple accents removed.
- **Two-pane Settings** with sections: General (language), Automation API
  (endpoint + key with show/hide and copy), Data Folder, Updates (app + kernel),
  Diagnostics (logs).
- API key masking (show/hide) and one-click copy.
# Changelog

All notable changes are documented here. Releases are published on
[GitHub Releases](https://github.com/wdnameless/antidetect-browser/releases).

## v0.2.19 — Profile bundles & structured logs (2026-08)

- **Profile bundles**: export/import a full profile (fingerprint seed+config, proxy
  with credentials, cookies, timezone, start_urls, mobile model) as one JSON file.
  UI: "Export Profile" in the row menu, "Import Bundle" in the header. Portable
  between machines (device presets re-linked by stable id).
  API: `GET /browser-profile/export`, `POST /browser-profile/import-bundle`.
- **Structured logs**: `data/logs/app-YYYY-MM-DD.log`, 1s buffered flush, daily
  rotation, 14-day retention. API: `GET /logs/list`, `GET /logs/get`.
  Settings → Diagnostics: "Open Logs Folder" + recent files.

## v0.2.18 — Server-side bulk & pagination

- Bulk endpoints (one request per action, per-item report):
  `POST /browser-profile/bulk-start | bulk-stop | bulk-delete | bulk-group`.
- Server-side `search` (name/id/proxy host), `platform` and `status` filters on
  `/browser/list` and the AdsPower v2 alias.
- UI pagination: 50/100/200 per page; bulk bar uses the new endpoints.

## v0.2.17 — Tests & CI

- Vitest suite (34 tests: presets, rate limit, auth, DB persistence, pagination,
  bundle roundtrip) in an isolated sandbox.
- GitHub Actions: typecheck + tests on push/PR; installer build+publish on `v*` tags.

## v0.2.16 — Data protection hardening

- **Atomic DB writes** (tmp + rename) — a crash can no longer corrupt the database.
- Debounced persist (100 ms) instead of a full-DB export on every statement.
- **Daily rotating backups** (last 5) in `data/backups`.
- **Crash recovery**: stale "running" profiles marked "closed" on startup.
- **Tree-kill** (`taskkill /T /F`) + process watchdog (kernel exit syncs DB status).
- **Graceful shutdown**: SIGINT/SIGTERM + Electron `before-quit` with DB flush.
- **Single-instance lock** (`service.lock`).
- **API hardening**: timing-safe key comparison, Host header validation
  (DNS-rebinding protection).

## v0.2.15 — Bulk actions bar & quick filters

- Floating bulk actions bar (start/stop/move to group/delete, select all).
- Platform and status filters in the profiles header; click-to-copy seed.

## v0.2.14 — UX polish

- Proxy type guide + friendly empty states; favicon; fixed device column duplication.

## v0.2.13 — Beginner-friendly UX

- Empty states with guidance (Profiles, Extensions); simplified fingerprint tab;
  clearer Settings copy.

## v0.2.12 — Groups page, rate-limit fix, duplicate profiles

- Dedicated Groups page (create/rename/delete with warnings, jump to profiles).
- Rate limits raised (lists 20/s, start/stop 10/s, /status 50/s) + transparent
  auto-retry with backoff on 429 in the renderer client.
- Duplicate profiles (UI + `POST /browser-profile/duplicate`).

## v0.2.11 — Manual seed & fixed phone model

- Manual fingerprint seed input; explicit phone model selection from the 30-model
  Android pool (long-lived accounts keep one "phone").
  API: `mobile_model_id` on create/update, `GET /device/mobile-presets`.

## v0.2.10 — Android phone pool

- 30 realistic Android presets (Pixel/Galaxy/Xiaomi/OnePlus/Nothing) with real
  GPU/WebGL renderers; deterministic per-seed phone selection.

## v0.2.6 – v0.2.9

- Bundled chromedriver (Selenium out of the box), start_urls, rate limiting with
  SDK auto-retry example, user-configurable data directory.
