import { describe, it, expect } from 'vitest';
import { nextOccurrences } from '../../src/renderer/src/cronProjection';

describe('cronProjection - nextOccurrences', () => {
  it('projects "0 9 * * 1-5" onto a month containing only weekday occurrences', () => {
    // September 2026:
    // Sept 1 is Tuesday, Sept 30 is Wednesday.
    const from = new Date(2026, 8, 1, 0, 0, 0); // 2026-09-01
    const until = new Date(2026, 8, 30, 23, 59, 59); // 2026-09-30

    const occurrences = nextOccurrences('0 9 * * 1-5', from, until);
    expect(occurrences.length).toBeGreaterThan(0);

    for (const occ of occurrences) {
      const day = occ.getDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
      expect(occ.getHours()).toBe(9);
      expect(occ.getMinutes()).toBe(0);
      expect(occ.getMonth()).toBe(8);
      expect(occ.getFullYear()).toBe(2026);
    }

    // In Sept 2026, 30 days.
    // Sept 5, 6, 12, 13, 19, 20, 26, 27 are weekends (8 days).
    // 30 - 8 = 22 weekdays.
    expect(occurrences.length).toBe(22);
  });

  it('handles month-boundary crossing cleanly (e.g. 31st -> 1st)', () => {
    // August 31 to September 2
    const from = new Date(2026, 7, 31, 10, 0, 0); // 2026-08-31 10:00 (after 9am run)
    const until = new Date(2026, 8, 2, 23, 59, 59); // 2026-09-02

    const occurrences = nextOccurrences('0 9 * * *', from, until);
    expect(occurrences.length).toBe(2); // Sept 1 and Sept 2
    expect(occurrences[0].getMonth()).toBe(8);
    expect(occurrences[0].getDate()).toBe(1);
    expect(occurrences[1].getMonth()).toBe(8);
    expect(occurrences[1].getDate()).toBe(2);
  });

  it('returns empty list for invalid expressions without throwing', () => {
    const from = new Date(2026, 8, 1);
    const until = new Date(2026, 8, 30);

    expect(nextOccurrences('', from, until)).toEqual([]);
    expect(nextOccurrences('not a cron', from, until)).toEqual([]);
    expect(nextOccurrences('* * * *', from, until)).toEqual([]);
    expect(nextOccurrences('99 99 99 99 99', from, until)).toEqual([]);
    expect(nextOccurrences('0 0 a-b * *', from, until)).toEqual([]);
  });

  it('calculates DST-agnostic local times correctly', () => {
    // Daily at 08:30 across potential boundary
    const from = new Date(2026, 2, 28, 0, 0, 0);
    const until = new Date(2026, 2, 31, 23, 59, 59);

    const occurrences = nextOccurrences('30 8 * * *', from, until);
    expect(occurrences.length).toBe(4);
    for (const occ of occurrences) {
      expect(occ.getHours()).toBe(8);
      expect(occ.getMinutes()).toBe(30);
    }
  });

  it('supports lists, steps, and ranges in standard 5-field format', () => {
    const from = new Date(2026, 8, 1, 0, 0, 0);
    const until = new Date(2026, 8, 1, 23, 59, 59);

    // Every 4 hours between 8 and 16, minutes 0,30
    const occurrences = nextOccurrences('0,30 8-16/4 * * *', from, until);
    // Hours matching: 8, 12, 16. Minutes: 0, 30. Total = 6
    expect(occurrences.length).toBe(6);
    expect(occurrences.map((d) => `${d.getHours()}:${d.getMinutes()}`)).toEqual([
      '8:0', '8:30', '12:0', '12:30', '16:0', '16:30'
    ]);
  });

  it('supports day-of-week 0-7 where 0 and 7 are Sunday', () => {
    // Sunday in Sept 2026: Sept 6, 13, 20, 27
    const from = new Date(2026, 8, 1);
    const until = new Date(2026, 8, 30);

    const occ0 = nextOccurrences('0 12 * * 0', from, until);
    const occ7 = nextOccurrences('0 12 * * 7', from, until);

    expect(occ0.length).toBe(4);
    expect(occ7.length).toBe(4);
    expect(occ0.map((d) => d.getDate())).toEqual([6, 13, 20, 27]);
    expect(occ7.map((d) => d.getDate())).toEqual([6, 13, 20, 27]);
  });
});
