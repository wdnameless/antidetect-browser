

export interface ScreenProtectionSeams {
  setContentProtection(value: boolean): void;
  getSystemIdleTime(): number;
  on(event: 'lock-screen' | 'suspend' | 'resume' | 'unlock-screen', handler: () => void): void;
}

export interface ScreenProtectionOptions {
  /** Idle minutes after which the app locks. 0 disables idle locking. */
  idleTimeoutMinutes?: number;
}

interface ScreenState {
  captureProtection: boolean;
  idleTimeoutMinutes: number;
  locked: boolean;
}

let state: ScreenState = {
  captureProtection: false,
  idleTimeoutMinutes: 15,
  locked: false,
};

let seams: ScreenProtectionSeams | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Injectable seams for tests. In production the Tauri shell installs them from Rust
 * (`src-tauri/src/screen.rs`), which provides the same three operations:
 *   - `setContentProtection` → Tauri's `set_content_protected`
 *     (`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Windows,
 *     `NSWindowSharingType::None` on macOS);
 *   - `getSystemIdleTime` → `GetLastInputInfo` on Windows;
 *   - `on('lock-screen'|'suspend'|…)` → `WM_POWERBROADCAST` and
 *     `WTSRegisterSessionNotification`/`WM_WTSSESSION_CHANGE` on Windows.
 * There is no Electron in this path: it was removed with the rest of the desktop runtime.
 */
export function setSeams(s: ScreenProtectionSeams | null): void {
  seams = s;
}

export function initScreenProtection(options: ScreenProtectionOptions = {}): void {
  state.idleTimeoutMinutes = options.idleTimeoutMinutes ?? 15;
  state.locked = false;
  // In Tauri / non-Electron mode without seams, system hooks are a no-op.
  if (seams) {
    seams.on('lock-screen', () => engageLock());
    seams.on('suspend', () => engageLock());
  }
  // Idle polling at 30s cadence; 0 disables.
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (state.idleTimeoutMinutes > 0) {
    pollTimer = setInterval(() => {
      if (state.locked || !seams) return;
      const idle = seams.getSystemIdleTime();
      const threshold = state.idleTimeoutMinutes * 60;
      if (idle >= threshold) {
        engageLock();
      }
    }, 30_000);
    if (pollTimer.unref) pollTimer.unref();
  }
}

/** Capture-protection toggle: calls the affinity guard exactly once per change. */
export function setCaptureProtection(enabled: boolean): void {
  if (state.captureProtection === enabled) return;
  state.captureProtection = enabled;
  if (seams) {
    seams.setContentProtection(enabled);
  }
  // When seams are not configured (Tauri mode), this is a no-op that does not throw.
}

export function engageLock(): void {
  if (state.locked) return;
  state.locked = true;
  if (seams) return;
  // In non-Electron environment without seams, state-only lock (no windows to hide).
}

export function unlock(_token: string): void {
  state.locked = false;
}

export function isLocked(): boolean {
  return state.locked;
}

export function getScreenState(): Readonly<ScreenState> {
  return state;
}

/** Test helper: resets module state. */
export function resetScreenState(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  state = { captureProtection: false, idleTimeoutMinutes: 15, locked: false };
}