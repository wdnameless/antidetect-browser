# Recon — profile transfer + portable update + MCP docs

Lane T2. Operator request (verbatim):

> «Окей, теперь опиши как работает наш мсп, должна быть кнопка перенести профили и они должны
> отображаться. Так же после того как все сделаешь выпусти новый релзи чтобы я проверил
> обновления прямо из приложения»

## Files touched

**Backend / shared**
- `src/main/api/routes/proxy.ts` — new `POST /api/v1/data/transfer` beside the existing scan
- `src/renderer/src/api.ts` — `dataTransfer(from)` client
- `tests/setup.ts` — also sandbox `ANTIDETECT_SETTINGS_DIR` (see defect 3 below)
- `tests/unit/dataTransfer.test.ts` — new, 7 cases

**UI**
- `src/renderer/src/pages/Settings.tsx` — transfer action per scan row
- `src/renderer/src/i18n.tsx` — Russian strings for the new labels

**Updater / release**
- `src-tauri/src/updater.rs` — `update_channel_target()`, `resolve_portable_target_exe()`
- `src-tauri/windows/portable.nsi` — exports `PORTABLE_EXECUTABLE_FILE=$EXEPATH`
- `scripts/build-updater-manifest.mjs` — portable entry + channel key scheme
- `.github/workflows/ci.yml` — passes the portable artefact; glob fixed
- `docs/MCP.md`, `CHANGELOG.md`, version files

## What the reconnaissance established (facts, not decisions)

- The app in use is the **portable** build (`%LOCALAPPDATA%\NullTrace\portable\0.6.3`), data dir
  `D:\NULLTRACE`, which held **0 profiles**. `GET /api/v1/data/scan` found
  `C:\Users\Administrator\.antidetect\data` with **3 profiles** (plus 3 fingerprints and 5
  devices).
- **No transfer existed.** The only action wired to a scan result was
  `window.antidetect.data.setDirPath(dir)` — switch the working folder and restart
  (`Settings.tsx:592` at the time).
- **The portable update was unsafe.** `latest.json` published only `windows-x86_64` → the NSIS
  setup. `is_portable_mode()` sees `PORTABLE_EXECUTABLE_DIR` and routes to
  `apply_portable_update`, which writes the downloaded bytes over `current_exe()` — the
  extracted shell, not the launcher. An installer over the shell.
- **The launcher never exported its own path**, so even a correct payload would have been
  written to a file the next launch discards.
- The oracle agent's ACCEPT verdict was rejected: it cited files that do not exist (see
  `.workflow/oracle-verdict.md`); acceptance was done directly instead.

## Acceptance check (all executed)

| Requirement | Evidence |
|---|---|
| Transfer moves profiles | Released 0.6.4 payload: `created: 3, dependencies: 3` |
| They appear, no restart | Released payload's UI: "Transferred 3 profiles", list shows all three with fingerprint seeds resolved |
| Never overwrites | Second transfer: `created: 0, skipped: 3`; count stayed 3 |
| Source untouched | Source DB mtime and 3 profiles unchanged |
| Installer unreachable by portable | Probe replay: 0.6.3 portable → portable launcher; 0.6.4 installed → setup |
| Release updatable in-app | `v0.6.4` published; `latest.json` verified against the live endpoint; both signatures `SIGNATURE VALID` |
| No regressions | `npm test` 131 files / 1069 passed; `cargo test` 33 passed; both typechecks clean |
