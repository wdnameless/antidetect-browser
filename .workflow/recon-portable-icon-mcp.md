# Recon — portable icon + "MCP won't turn on"

Lane T1. Two user complaints, three causes. Evidence gathered 2026-09-17 against the
running 0.6.2 portable (PID 18228/15148, data dir `D:\NULLTRACE`).

## Issue 1 — launcher icon is the NSIS default, not the brand mark

- `src-tauri/icons/icon.ico` has 6 frames (16…256); `nulltrace-tauri-shell.exe` embeds all
  6 **byte-identical** to the brand frames.
- `NullTrace-0.6.2-portable-win-x64.exe` (both the repo build and the copy in
  `~/Downloads`) embeds **1 frame**, from resource group 103 — the NSIS default
  `modern-install.ico`, i.e. not the brand mark. Verified by parsing the PE resource
  directory (`D:/tmp/iconchk/iconpe.mjs`), not by eye.
- Cause: `src-tauri/windows/portable.nsi` has **no `Icon` directive and no `MUI_ICON`**
  define. NSIS compiles its own default into the launcher; `MUI_INSERT` never runs because
  the script defines no pages, so even MUI2's defaults never reached `Icon`.
  `scripts/build-portable.mjs` never substituted an icon path either.
- Files touched: `src-tauri/windows/portable.nsi`, `scripts/build-portable.mjs`.

## Issue 2 — panel reports "MCP: Off" while the server runs (two independent causes)

1. **Shipped build predates the fix.** Live API (`/api/v1/mcp/status`, key from
   `D:\NULLTRACE\api_key`): `{"running":true,"transport":"http","httpPort":30339,
   "toolCount":47,...}` — and the panel at `http://127.0.0.1:50325` renders **"MCP: Off"**.
   The installed payload's `dist/src/main/api/routes/mcp.js` (extracted 2026-09-16 06:33,
   launcher run 09:01) returns the **bare status object**, while the renderer requires the
   `{code,msg,data}` envelope. Commit `7d88c69` (09:50) fixed the source; the portable
   artefact (09:48) and the user's download (09:00) both predate it. `dist/` in the repo is
   from 09:40 and **does** contain the envelope, so the source fix is real but unpackaged.
   Only `Portable\0.6.2` (from `$LOCALAPPDATA`) had been run — that is the stale copy.
2. **Stale extraction dir.** The launcher writes to `…/portable/<version>`; with the version
   unchanged at 0.6.2, re-running the fixed launcher overwrites the same directory, which is
   why a rebuild alone does not help an already-extracted 0.6.2 unless the files are replaced.

## Finding 3 — the password the user set is in a different data directory

- Live data dir is `D:\NULLTRACE` (recorded in `%APPDATA%\antidetect-browser\settings.json`).
  It has **no** `panel_auth.json`; `/api/v1/ui/auth-state` answers `hasPassword:false`.
- The password file exists at `~/.antidetect/data/panel_auth.json` (username `admin`,
  written 2026-09-14), i.e. the pre-writable-data-dir location from before the data dir was
  moved to `D:\NULLTRACE`. Its hash does **not** match the password the user reported, and no
  `panel_auth.json` exists anywhere else on C:/D: (recursive search).
- Consequence: on the running build there is no panel password at all, so the app does not
  gate the UI (by design: `App.tsx` enters directly when `hasPassword === false`). The 6+
  char setup form in `LoginScreen` is the only path that writes a new one to the live dir.

## Acceptance check

- Launcher icon: every `RT_ICON` frame in the rebuilt portable is byte-identical to a frame
  of `src-tauri/icons/icon.ico`.
- MCP: rebuilt payload's `/api/v1/mcp/status` answers the envelope, and the panel renders the
  tool count (**47 tools**) instead of **Off**, at the moment the backend reports
  `running:true`.
