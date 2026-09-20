# Recon — portability and interface cleanup

Operator message (verbatim, 2026-09-19):

> Проверь, чтобы наш спорт был реально хранился в одной папке и не создавал в системе под
> папок, чтобы можно было взять, перенести браузер на флешке и открыть все со своими
> профилями и сессиями.
>
> Потом из интерфейса профилей вот эти столбики девайс ОС фингерпринт при флайт можешь убрать
> они не нужны.
>
> Также импорт импорт банду все это перенеси в настройки в data folder
>
> Также мне интересно, почему, когда открываю девайсы с написано, что находится в Workspace,
> хотя он находится в library
>
> И как работает наша МСП чему навсегда выключена? Зачем копировать конфиг эту кнопку тоже
> можешь убрать. И документация кнопка не работает должна вести в нашу документацию на GitHub.
>
> Также версию браузера снизу и вот этот текст на чек-то обновление давай как-то сделаем более
> красивым анимационным и чтобы она вписывалась в общий стиль.

## The portability problem, measured

The application is **not** self-contained today. Three things live outside the folder being copied:

| What | Where | Evidence |
|---|---|---|
| `settings.json` (holds the recorded `dataDir`) | `%APPDATA%\antidetect-browser` | on this machine it contains `{"dataDir": "D:\\NULLTRACE"}` |
| WebView2 cache | `%LOCALAPPDATA%\NullTrace` | Cache, Code Cache, GPUCache, Local Storage, Network, Preferences — recreated on every machine |
| MCP audit log | `%APPDATA%\antidetect-browser\mcp-audit.jsonl` | `mcp/src/audit.ts:44` |

A second settings file and a full data tree also exist at `~/.antidetect/data` (database, api_key,
backups, chromium, extensions, logs) — legacy from a build that predated the folder choice.

**Why it breaks when moved:** `resolveDataDir()` honours a recorded `settings.dataDir`
*unconditionally*. On a USB stick that is the old machine's absolute path, which does not exist on
the new one — so the app would resolve to a folder that is not there, and because the settings file
that recorded the choice is itself outside the folder, on a fresh machine there is nothing to
resolve from at all.

## Mechanism chosen, and why

- `WebviewWindowBuilder::data_directory(PathBuf)` in Tauri 2.11.5 takes an **absolute** path
  (`tauri-2.11.5/src/webview/webview_window.rs:1024`). The config-file equivalent only accepts a
  *relative* path and rejects an absolute one, so the builder call is the only way to pin the cache
  beside the executable.
- The launcher already exports `PORTABLE_EXECUTABLE_DIR` = `$EXEDIR` — the folder the operator
  copies (`src-tauri/windows/portable.nsi:88`). That is the anchor point for everything.
- Settings move inside that folder in portable mode, so the recorded choice travels with the data.
- A recorded path is honoured **while it exists and holds data**; otherwise the portable folder is
  used. This is what makes a moved stick work without relocating any live data: on the original
  machine `D:\NULLTRACE` still resolves, on a new machine it does not and the folder beside the
  executable wins. "Holds data" is the load-bearing test — the code already contains the precedent
  that an eagerly-created empty directory proves nothing (`needsFirstRunDataChoice`).

## The other five, with what was found

| Report | Finding |
|---|---|
| Remove Device/OS, Fingerprint, Preflight columns | Declared in `Profiles.tsx` ~1555 together with the body cells |
| Move Import/Export CSV and Import Bundle to Settings | In the Profiles toolbar at ~1407-1413; the handlers live in the same file |
| Breadcrumb says "Workspace" on a Library page | `App.tsx` renders a literal `Workspace`; `NAV_GROUPS` and each destination's `group` field already carry the truth |
| MCP always off | Nothing starts it at boot — only the panel control and the API route do |
| Remove the MCP-config button | `AutomationPanel.tsx` ~232 |
| Documentation does nothing | `AutomationPanel.tsx` ~237 uses `target="_blank"`, which a Tauri webview ignores without a handler; the shell already exposes `open_path` |
| Version line styling | Plain 10.5px muted text with no state treatment |

## Files touched

| Slice | Files |
|---|---|
| PortableState | `src/main/config.ts`, `mcp/src/audit.ts` |
| PortableShell | `src-tauri/src/main.rs` |
| McpAutostart | `src/main/index.ts`, `src/main/api/routes/mcp.ts` |
| SidebarUiCleanup | `App.tsx`, `Profiles.tsx`, `Settings.tsx`, `AutomationPanel.tsx`, `styles.css`, `i18n.tsx` |

## Acceptance check (planned)

| Req | How it will be proven |
|---|---|
| R01 | A portable launch resolves settings, data, webview cache and audit log inside the folder |
| R02 | After such a launch, nothing new appears under `%APPDATA%` or `%LOCALAPPDATA%` |
| R03 | A stale absolute path recorded in the portable settings does not redirect the data dir |
| R04 | The rendered header has no Device/OS, Fingerprint or Preflight cell |
| R05 | The Profiles toolbar lacks the three actions; Settings offers them |
| R06 | Breadcrumbs read Library for Devices/Extensions, System for Settings |
| R07 | `GET /api/v1/mcp/status` reports running after a plain start |
| R08 | The panel has no MCP-config control |
| R09 | Documentation opens a GitHub URL externally |
| R10 | The version control renders a distinct state class and honours reduced motion |
