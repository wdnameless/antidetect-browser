import { describe, it, expect } from 'vitest';
import { parseSchedule, isDue, isValidSchedule } from '../../src/main/scripts/triggerScheduler';

const MIN = 60_000;
const TICK = 30_000;

describe('trigger scheduler matching (Sprint 4.3)', () => {
  it('parses interval schedules', () => {
    expect(parseSchedule('interval:60')).toEqual({ kind: 'interval', intervalMs: 60 * MIN });
    expect(parseSchedule('interval:5')).toEqual({ kind: 'interval', intervalMs: 5 * MIN });
  });

  it('parses daily schedules (HH:MM)', () => {
    expect(parseSchedule('daily:09:30')).toEqual({ kind: 'daily', hour: 9, minute: 30 });
    expect(parseSchedule('daily:0:0')).toEqual({ kind: 'daily', hour: 0, minute: 0 });
  });

  it('rejects malformed schedules', () => {
    expect(parseSchedule('interval')).toBeNull();
    expect(parseSchedule('interval:0')).toBeNull();
    expect(parseSchedule('interval:-5')).toBeNull();
    expect(parseSchedule('interval:abc')).toBeNull();
    expect(parseSchedule('daily:24:00')).toBeNull(); // hour out of range
    expect(parseSchedule('daily:10:60')).toBeNull(); // minute out of range
    expect(parseSchedule('weekly:mon')).toBeNull();
    expect(parseSchedule('')).toBeNull();
    expect(isValidSchedule('interval:30')).toBe(true);
    expect(isValidSchedule('daily:23:59')).toBe(true);
    expect(isValidSchedule('daily:24:00')).toBe(false);
  });

  it('interval: never-fired trigger is due immediately', () => {
    const p = parseSchedule('interval:60')!;
    expect(isDue(p, null, Date.now())).toBe(true);
  });

  it('interval: not due before the interval elapsed', () => {
    const now = 1_000_000_000;
    const p = parseSchedule('interval:60')!;
    expect(isDue(p, now - 30 * MIN, now)).toBe(false); // 30 min < 60 min
  });

  it('interval: due once the interval elapsed', () => {
    const now = 1_000_000_000;
    const p = parseSchedule('interval:60')!;
    expect(isDue(p, now - 61 * MIN, now)).toBe(true);
    expect(isDue(p, now - 60 * MIN, now)).toBe(true); // exactly at the boundary
  });

  it('daily: due inside the tick window, only once per day', () => {
    // Local-time construction keeps the test TZ-independent.
    const base = new Date();
    base.setHours(10, 0, 0, 0);
    const now = base.getTime();
    const p = parseSchedule('daily:10:00')!;
    expect(isDue(p, null, now)).toBe(true);
    // fired earlier the same day -> not due again
    expect(isDue(p, base.getTime() - 5 * MIN, now)).toBe(false);
    // fired yesterday -> due again today
    expect(isDue(p, base.getTime() - 24 * 60 * MIN, now)).toBe(true);
  });

  it('daily: not due outside the tick window', () => {
    const base = new Date();
    base.setHours(10, 0, 0, 0);
    const before = base.getTime() - 10 * MIN; // well before the HH:MM window
    const p = parseSchedule('daily:10:00')!;
    expect(isDue(p, null, before)).toBe(false);
    const after = base.getTime() + 5 * MIN; // window already passed
    expect(isDue(p, null, after)).toBe(false);
  });

  it('tick window constant matches the scheduler spec (30s)', () => {
    // The daily window is the clock minute HH:MM (the 30s tick samples it
    // twice, so the trigger still fires exactly once per day thanks to the
    // same-day last-fired check).
    const base = new Date();
    base.setHours(10, 0, 0, 0);
    const p = parseSchedule('daily:10:00')!;
    expect(isDue(p, null, base.getTime(), TICK)).toBe(true);
    expect(isDue(p, null, base.getTime() + 59_000, TICK)).toBe(true); // still 10:00:59
    expect(isDue(p, null, base.getTime() + 61_000, TICK)).toBe(false); // 10:01:01
    // once fired today, no repeat even inside the window
    expect(isDue(p, base.getTime(), base.getTime() + 10_000, TICK)).toBe(false);
  });
});