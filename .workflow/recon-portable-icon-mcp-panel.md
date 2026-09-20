# Recon — portable icon parity, MCP panel restored, backend lifecycle

Reported by the operator in one message:

> Во-первых, иконка Portabll-Приложения должна быть, как наша иконка браузера.
> Во-вторых, МСП не включается. Я задал новый пароль. vlad22067
> Прроверь все

Three complaints, and they turned out to be one symptom plus one unrelated defect.

## Files touched

| File | Change |
|---|---|
| `src-tauri/build.rs` | `winresource` embeds the brand mark into the shell exe; `tauri-build` does not emit the icon resource for portable builds |
| `src-tauri/windows/hooks.nsh` | `MUI_ICON`/`MUI_UNICON` for the installer and the uninstaller shortcut |
| `src-tauri/portable.nsi` | icon group, `Icon`/`UninstallIcon`, and the extraction of the branded exe |
| `scripts/verify-exe-icon.py` | parses the PE resource table and compares frames against `assets/brand/nulltrace-icon.ico` |
| `src-tauri/tauri.conf.json` | window title `NullTrace`; brand icons listed |
| `src-tauri/src/main.rs` | job object around the backend; readiness from the backend's own line; title application |
| `src-tauri/src/sidecar.rs` | `self.child` recorded; `JobHandle`; readiness rewritten |
| `src-tauri/src/screen.rs` | `SetWindowTextW` for non-ASCII profile names |
| `src/renderer/src/App.tsx` | `<AutomationPanel />` restored to the sidebar footer |
| `tests/unit/rendererComponentMounting.test.ts` | new guard: every imported component must be rendered |

## Root cause of «МСП не включается»

Three separate failures stacked, and the operator saw only the last one.

1. **The panel was gone.** `6c55775` ("the sidebar is fixed, because the operator removed the
   collapse") deleted `<AutomationPanel />` together with the `{!sidebarCollapsed && ...}` guard
   around it and left the import. An unused import typechecks and builds, so nothing failed —
   the MCP badge and its start/stop control were simply absent from the product.
2. **The backend was never recorded.** `SidecarManager::start` dropped the spawned child, so
   `self.child` stayed `None` and both stop paths returned early. The backend outlived the shell,
   holding the API port and `service.lock`.
3. **Readiness accepted any listener.** A bare TCP connect counted as a successful start, so the
   next launch attached to the *orphaned* backend. Measured on this machine: the running 0.6.10
   shell served a footer reading `v0.6.8` from a process that had already exited, with
   `service.lock` naming a dead pid.

The `vlad22067` password was not implicated. It is not persisted anywhere in the app and the
panel's "Off" state was about reachability, not authentication — once the backend is alive the
panel reads On regardless. No credential was written to any file.

## Acceptance check

| Claim | Evidence |
|---|---|
| Launcher carries the brand mark | `scripts/verify-exe-icon.py` on the built exe: 9 RT_ICON frames, all matching the brand ico |
| Window title is the product name | live `MainWindowTitle: NullTrace` |
| Shell refuses a foreign listener | new shell + squatter on its port -> `Port 50940 is already in use`, no attach |
| The OS kills the backend with the shell | started cleanly, `taskkill /F` with no teardown, backend processes `1 -> 0`, port released |
| The panel is back and readable | live browser against the running install: `AUTOMATION API On`, `MCP: 47 tools` |
| MCP actually serves | `initialize` over the MCP transport returns HTTP 200 and the server's real capabilities |
| Guard catches the regression | removing `<AutomationPanel />` fails 2 tests; restoring it passes 3 |
| Nothing else broke | `npx vitest run`: 134 files, 1111 passed, 1 skipped; `cargo test`: 37 passed |

## Left on the machine

- `D:\NULLTRACE\NullTrace-0.6.11-portable-win-x64.exe` and the Desktop copy — the fixed build.
- The app itself, running: backend up, MCP on, 3 profiles listed.
- The older 0.6.7/0.6.8 launchers were **not** deleted; the operator may remove them himself.
