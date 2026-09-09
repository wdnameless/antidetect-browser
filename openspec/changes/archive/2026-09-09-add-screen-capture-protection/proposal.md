## Why

Afina ships screen-capture protection and auto-lock for operator machines handling account credentials. Our app renders vault passwords (reveal endpoint) and API keys in plaintext on screens with no protection against OBS/AnyDesk/Teams capture or shoulder-surfing.

## What Changes

- Electron main-process module `src/main/security/screenProtection.ts`:
  - `setCaptureProtection(enabled)` — `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` on the main window (Windows 10 2004+; on older builds falls back to `WDA_MONITOR`), toggle in Settings.
  - Idle auto-lock: after a configurable idle timeout (default 15 min, 0 = off), the app locks: all windows hidden, an unlock overlay requires the OS-user re-auth (`safeStorage`-wrapped unlock token) — no new master-password surface in this slice.
  - Lock also engages on session lock/suspend via Electron `powerMonitor` events.
- Settings page section "Security": capture protection toggle, idle timeout input.
- Running browsers (Chromium windows) are NOT capture-protected in this slice (separate hardening; noted as non-goal).

## Capabilities

### New Capabilities
- `screen-capture-protection`: display-affinity hardening, idle auto-lock, session-lock/suspend engagement, settings surface.

## Impact

- `src/main/security/screenProtection.ts` (new; koffi or `ffi-napi`-free approach: `user32.dll` via Node-API-free `windows`-API binding already available? — see design), `src/main/index.ts` (init + settings wiring), `src/renderer/src/pages/Settings.tsx` (Security section), tests in `tests/unit/screenProtection.test.ts`.
- No new native module dependency: `SetWindowDisplayAffinity` is called through Electron's `BrowserWindow` where possible and a minimal `powershell`/`rundll32`-free path otherwise (design decides; tests use an injectable affinity seam like `setProcessInspectorExec`).