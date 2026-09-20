# Requirements manifest — portability and interface cleanup

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

Answered forks (Wave 0 widget):

> portable: Полная переносимость — всё рядом с .exe
> columns: Убрать все три столбца
> mcp: Включать MCP автоматически при запуске

| ID | Requirement | Verbatim quote | Acceptance (observable) |
|---|---|---|---|
| R01 | The whole application state lives in one folder beside the launcher, so the folder can be copied to a USB stick and opened on another machine with profiles and sessions intact | «чтобы наш спорт был реально хранился в одной папке… взять, перенести браузер на флешке и открыть все со своими профилями и сессиями» | With `PORTABLE_EXECUTABLE_DIR` set, the resolved data dir is `<that dir>/data`; the settings file, the API key, the MCP audit log and the profile workspaces all resolve under it; nothing under `%APPDATA%` or `%LOCALAPPDATA%` is required to start |
| R02 | No sub-folder is created anywhere else in the system by a normal run | «не создавал в системе под папок» | After a launch from a fresh directory, the only directories created are inside the chosen folder; `%APPDATA%\antidetect-browser` gains no settings file and `~/.antidetect` is not consulted |
| R03 | A recorded folder choice cannot override portability — moving the stick must not point at the old machine's absolute path | (implied by R01) | A `settings.json` inside the portable folder holding `dataDir: D:\OLDPC\data` does not redirect the data dir away from the portable folder |
| R04 | The profiles table drops the Device/OS, Fingerprint and Preflight columns | «вот эти столбики девайс ОС фингерпринт при флайт можешь убрать они не нужны» | The table renders Profile Name, Proxy, Status, Actions and no other data column; the header carries no `Device / OS`, `Fingerprint` or `Preflight` cell |
| R05 | Import CSV, Export CSV and Import Bundle move from the Profiles toolbar into Settings, Data Folder | «импорт импорт банду все это перенеси в настройки в data folder» | The Profiles toolbar no longer contains them; Settings → Data Folder offers all three and each still performs its action |
| R06 | The breadcrumb names the sidebar group a page belongs to | «почему, когда открываю девайсы с написано, что находится в Workspace, хотя он находится в library» | On the Devices page the breadcrumb reads `Library / Devices`, not `Workspace / Devices`; likewise Extensions reads `Library`, Settings reads `System`, Profiles reads `Workspace` |
| R07 | MCP starts automatically with the application | «как работает наша МСП чему навсегда выключена?» | After a normal start, `GET /api/v1/mcp/status` reports `running: true` without any click |
| R08 | The MCP panel no longer offers "MCP config" | «Зачем копировать конфиг эту кнопку тоже можешь убрать» | The panel contains no control that copies the MCP client configuration |
| R09 | The Documentation button opens the project's documentation on GitHub | «документация кнопка не работает должна вести в нашу документацию на GitHub» | Clicking it opens a GitHub URL in the system browser; it is not a no-op inside the app window |
| R10 | The version and update line at the bottom of the sidebar is restyled and animated to match the interface | «версию браузера снизу и вот этот текст на чек-то обновление давай как-то сделаем более красивым анимационным и чтобы она вписывалась в общий стиль» | The version line uses the app's design tokens (no bespoke colours), shows a visible state transition while checking, and honours `prefers-reduced-motion` |

## Out of scope

- Moving browser kernels or extension archives into the portable folder — they already resolve
  through `DATA_DIR`, so R01 covers them.
- Redesigning the Settings page beyond adding the three actions.
- Changing what the update check does; only how it looks.

## Constraints

- Fail-closed security is untouched: the stealth key, extension signatures and the update
  signature all keep working from the new location.
- An existing installation must keep finding its data: a recorded absolute path still wins when
  the operator chose one deliberately (R03 narrows this to the portable case only).
- No new runtime dependency.
