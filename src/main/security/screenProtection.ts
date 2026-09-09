

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
 * Injectable seams for tests: setContentProtection mirrors
 * BrowserWindow.setContentProtection (WDA_EXCLUDEFROMCAPTURE on Windows),
 * idle source mirrors powerMonitor.getSystemIdleTime, on mirrors
 * powerMonitor.on. Production passes the real Electron objects.
 */
export function setSeams(s: ScreenProtectionSeams | null): void {
  seams = s;
}

export function initScreenProtection(options: ScreenProtectionOptions = {}): void {
  state.idleTimeoutMinutes = options.idleTimeoutMinutes ?? 15;
  state.locked = false;

  // Wire system lock/suspend engagement (real or seam).
  const hook = (event: 'lock-screen' | 'suspend' | 'resume' | 'unlock-screen', handler: () => void) => {
    if (seams) {
      seams.on(event, handler);
    } else {
      // Production: real Electron powerMonitor (loaded lazily; tests use seams).
      const pm = require('electron') as { powerMonitor: { on(event: string, handler: () => void): void } };
      pm.powerMonitor.on(event, handler);
    }
  };
  hook('lock-screen', () => engageLock());
  hook('suspend', () => engageLock());

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
  } else {
    // Production: apply to every app window through Electron.
    const { BrowserWindow } = require('electron') as { BrowserWindow: { getAllWindows(): Array<{ setContentProtection(value: boolean): void }> } };
    for (const win of BrowserWindow.getAllWindows()) {
      win.setContentProtection(enabled);
    }
  }
}

export function engageLock(): void {
  if (state.locked) return;
  state.locked = true;
  if (seams) return;
  // Production: hide every window behind the unlock overlay.
  try {
    const { BrowserWindow } = require('electron') as { BrowserWindow: { getAllWindows(): Array<{ hide(): void }> } };
    for (const win of BrowserWindow.getAllWindows()) {
      win.hide();
    }
  } catch {
    // Electron not available (tests without seams) — state-only lock.
  }
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