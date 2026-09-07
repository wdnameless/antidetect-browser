# Design: Screen Capture Protection + Auto-Lock

## Key Decisions

1. **Affinity call seam**: Electron exposes no direct `SetWindowDisplayAffinity`. The module calls it through `koffi`-free minimal binding: `ffi` via `node-ffi` is a native dep the repo avoids; instead we use Electron's built-in `BrowserWindow.setContentProtection(true)` — Electron ≥ 20 implements `setContentProtection` on Windows exactly as `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` (and on macOS as `NSWindow.sharingType`, future-proofing the Linux/mac hosts). Zero new dependencies.
2. **Auto-lock model**: idle detection via `powerMonitor.getSystemIdleTime()` polled every 30s (cheap, no native dep). On lock: `win.hide()` + `app.hide()`-equivalent overlay shown on re-activation requiring OS re-auth token — in this slice the unlock is a confirmation step storing a `safeStorage`-sealed timestamp; full OS-credential gating is a follow-up if desired (documented non-goal).
3. **Session events**: `powerMonitor` `lock-screen`/`suspend` engage the same lock path immediately.
4. **Chromium windows excluded**: profile browsers are separate processes; protecting them is a separate slice (non-goal, recorded).
5. **Injectable seams for tests**: `setContentProtection` and idle-time source are injectable (module-level setters, pattern of `setProcessInspectorExec`); tests never touch a real window.

## Testing Strategy

- `tests/unit/screenProtection.test.ts`:
  - toggle routes to `setContentProtection(true/false)` seam exactly once per change;
  - idle poll triggers lock at threshold, not before; `0` disables polling;
  - `lock-screen`/`suspend` events engage lock regardless of idle;
  - lock hides windows and shows overlay state; unlock path clears it;
  - settings persistence roundtrip (capture flag, timeout).