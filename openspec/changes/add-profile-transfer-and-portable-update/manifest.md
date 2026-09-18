# Requirements manifest — profile transfer, portable update, MCP docs

Change: `openspec/changes/add-profile-transfer-and-portable-update`
Source: user message 2026-09-18 — «теперь опиши как работает наш мсп, должна быть кнопка
перенести профили и они должны отображаться. Так же после того как все сделаешь выпусти новый
релзи чтобы я проверил обновления прямо из приложения» + screenshot of Settings → Data Folder.

Lane T2. Wave 0 answers recorded below (all four forks resolved by the user via the widget).

| ID | Requirement (verbatim from the user) | Status |
|---|---|---|
| R01 | «должна быть кнопка перенести профили» — a transfer button exists that moves profiles into the data folder in use | in-spec |
| R02 | «и они должны отображаться» — after the transfer the profiles appear in the Profiles list, without a restart | in-spec |
| R03 | Transfer is an IMPORT into the current data folder (merge), not a switch of the working folder — Wave 0 answer `transfer_semantics` | in-spec |
| R04 | Transfer carries the profile's dependencies — fingerprints, devices, groups, proxies — so a transferred profile can actually launch — Wave 0 answer `transfer_scope` | in-spec |
| R05 | «опиши как работает наш мсп» — a written explanation of how the MCP server works | in-spec |
| R06 | The explanation goes in the chat reply AND updates `docs/MCP.md` — Wave 0 answer `mcp_docs` | in-spec |
| R07 | «выпусти новый релзи чтобы я проверил обновления прямо из приложения» — a new release the user can update to from inside the app | in-spec |
| R08 | The in-app update path must work for the PORTABLE build the user runs; a separate portable entry in `latest.json` — Wave 0 answer `portable_update` | in-spec |
| R09 | i01: the existing «Use this folder» / switch-folder behaviour stays as-is beside the new transfer action (the user's screenshot shows both paths) | in-spec |
| R10 | i02: profile transfer must not overwrite an existing profile with the same id; it reports what it skipped | in-spec |
| R11 | i03: the transfer reports a real count — created / skipped — and surfaces unreadable source databases instead of failing silently | in-spec |

## Wave 0 answers (verbatim, from the `ask` widget)

- `transfer_semantics` → **Импорт в текущую папку (слияние)**
- `transfer_scope` → **Профили + зависимости**
- `portable_update` → **Отдельная portable-запись**
- `mcp_docs` → **Ответ в чате + docs/MCP.md**

## Facts established by reconnaissance (not decisions)

- The running app is the **portable** build: `%LOCALAPPDATA%\NullTrace\portable\0.6.3`, and the
  backend reports `portable:true` with `currentDir = D:\NULLTRACE`.
- `GET /api/v1/data/scan` already finds `C:\Users\Administrator\.antidetect\data` with
  **3 profiles** and `%APPDATA%\antidetect-browser\data` with 0. Current dir `D:\NULLTRACE` has 0.
- Those 3 profiles reference 3 fingerprints; there are 5 devices in that database. The profile
  directory on disk holds 1 workspace folder.
- **The transfer does not exist**: the only action wired to a scan result is
  `window.antidetect.data.setDirPath(dir)` (Settings.tsx:592) — i.e. switch the folder and
  restart. There is no import/merge path at all.
- **The portable update path is unsafe as written**: `latest.json` publishes only
  `windows-x86_64` → the NSIS **setup installer**. `updater.rs::is_portable_mode()` sees
  `PORTABLE_EXECUTABLE_DIR` and calls `apply_portable_update`, which writes those bytes to
  `<exe>.new` and `move /Y`s them over `nulltrace-tauri-shell.exe` — replacing the shell with
  an installer. That is the defect R08 addresses.
