import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initScreenProtection,
  setCaptureProtection,
  engageLock,
  unlock,
  isLocked,
  setSeams,
  getScreenState,
} from '../../src/main/security/screenProtection';

describe('screen capture protection + auto-lock (parity program)', () => {
  let setContentProtectionCalls: boolean[];
  let idleTime: number;
  let powerEvents: Record<string, () => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    setContentProtectionCalls = [];
    idleTime = 0;
    powerEvents = {};
    setSeams({
      setContentProtection(value) {
        setContentProtectionCalls.push(value);
      },
      getSystemIdleTime() {
        return idleTime;
      },
      on(event, handler) {
        powerEvents[event] = handler;
      },
    });
    initScreenProtection({ idleTimeoutMinutes: 15 });
  });

  afterEach(() => {
    setSeams(null);
    vi.useRealTimers();
  });

  it('toggle routes setContentProtection exactly once per change and persists', async () => {
    await setCaptureProtection(true);
    expect(setContentProtectionCalls).toEqual([true]);
    await setCaptureProtection(true);
    expect(setContentProtectionCalls).toEqual([true]); // same value: no extra call
    await setCaptureProtection(false);
    expect(setContentProtectionCalls).toEqual([true, false]);
    expect(getScreenState().captureProtection).toBe(false);
  });

  it('idle poll engages lock at threshold, not before', () => {
    vi.advanceTimersByTime(30_000); // first poll tick
    expect(isLocked()).toBe(false);

    idleTime = 14 * 60; // 14 minutes — below threshold
    vi.advanceTimersByTime(30_000);
    expect(isLocked()).toBe(false);

    idleTime = 15 * 60; // exactly at threshold
    vi.advanceTimersByTime(30_000);
    expect(isLocked()).toBe(true);
  });

  it('idle timeout 0 disables the idle lock entirely', () => {
    initScreenProtection({ idleTimeoutMinutes: 0 });
    idleTime = 10 * 60 * 60;
    vi.advanceTimersByTime(60_000 * 10);
    expect(isLocked()).toBe(false);
  });

  it('system lock-screen and suspend engage the lock regardless of idle', () => {
    idleTime = 0;
    powerEvents['lock-screen']?.();
    expect(isLocked()).toBe(true);

    unlock('test-token');
    expect(isLocked()).toBe(false);

    powerEvents['suspend']?.();
    expect(isLocked()).toBe(true);
  });

  it('unlock clears the lock state', () => {
    engageLock();
    expect(isLocked()).toBe(true);
    unlock('token');
    expect(isLocked()).toBe(false);
  });
});