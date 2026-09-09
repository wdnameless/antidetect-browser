/**
 * cronProjection.ts
 *
 * Implements nextOccurrences(expr, from, until) for standard 5-field cron:
 * min (0-59), hour (0-23), dom (1-31), month (1-12), dow (0-7, 0 & 7 = Sunday).
 * Supports lists (,), ranges (-), steps (/), wildcard (*).
 * Invalid expressions return [] and never throw.
 */

function parseField(field: string, min: number, max: number, allowSevenForZero = false): number[] | null {
  if (!field || typeof field !== 'string') return null;
  const parts = field.split(',');
  const values = new Set<number>();

  for (const part of parts) {
    if (!part) return null;

    // Step: e.g. */5 or 1-10/2
    let step = 1;
    let rangePart = part;
    if (part.includes('/')) {
      const stepSplits = part.split('/');
      if (stepSplits.length !== 2) return null;
      rangePart = stepSplits[0];
      step = parseInt(stepSplits[1], 10);
      if (isNaN(step) || step <= 0) return null;
    }

    let start = min;
    let end = max;

    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const rangeSplits = rangePart.split('-');
      if (rangeSplits.length !== 2) return null;
      start = parseInt(rangeSplits[0], 10);
      end = parseInt(rangeSplits[1], 10);
      if (isNaN(start) || isNaN(end) || start > end) return null;
    } else {
      const single = parseInt(rangePart, 10);
      if (isNaN(single)) return null;
      start = single;
      end = single;
    }

    if (allowSevenForZero) {
      if (start < 0 || end > 7) return null;
    } else {
      if (start < min || end > max) return null;
    }

    for (let v = start; v <= end; v += step) {
      if (allowSevenForZero && v === 7) {
        values.add(0);
      } else {
        values.add(v);
      }
    }
  }

  if (values.size === 0) return null;
  return Array.from(values).sort((a, b) => a - b);
}

export interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

export function parseCron(expr: string): ParsedCron | null {
  if (!expr || typeof expr !== 'string') return null;
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minStr, hourStr, domStr, monthStr, dowStr] = fields;

  const minutes = parseField(minStr, 0, 59);
  const hours = parseField(hourStr, 0, 23);
  const daysOfMonth = parseField(domStr, 1, 31);
  const months = parseField(monthStr, 1, 12);
  const daysOfWeek = parseField(dowStr, 0, 7, true);

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
    return null;
  }

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek
  };
}

/**
 * Returns all occurrence Dates matching expr between from and until (inclusive).
 * Time evaluated in local time.
 * If expression is invalid, returns [].
 */
export function nextOccurrences(expr: string, from: Date, until: Date, maxCount = 500): Date[] {
  try {
    const parsed = parseCron(expr);
    if (!parsed) return [];
    if (from > until) return [];

    const results: Date[] = [];
    // Start iterator from 'from' floored to minutes
    const current = new Date(from.getTime());
    current.setSeconds(0, 0);
    if (current < from) {
      current.setMinutes(current.getMinutes() + 1);
    }

    const untilTime = until.getTime();

    // Iterate through candidates. To be performant across ranges, we can iterate day by day,
    // or step minute by minute. Given standard projection is within a month (~31 days * 24 hours * 60 min = ~44640 min),
    // we can iterate day-by-day and then loop over matching hours & minutes.
    const loopDay = new Date(current.getFullYear(), current.getMonth(), current.getDate());
    const endDay = new Date(until.getFullYear(), until.getMonth(), until.getDate());

    while (loopDay <= endDay && results.length < maxCount) {
      const year = loopDay.getFullYear();
      const month = loopDay.getMonth() + 1; // 1-12
      const dom = loopDay.getDate(); // 1-31
      const dow = loopDay.getDay(); // 0-6

      if (parsed.months.includes(month) && parsed.daysOfMonth.includes(dom) && parsed.daysOfWeek.includes(dow)) {
        for (const h of parsed.hours) {
          for (const m of parsed.minutes) {
            const candidate = new Date(year, loopDay.getMonth(), dom, h, m, 0, 0);
            const candidateTime = candidate.getTime();
            if (candidateTime >= from.getTime() && candidateTime <= untilTime) {
              results.push(candidate);
              if (results.length >= maxCount) break;
            }
          }
          if (results.length >= maxCount) break;
        }
      }

      loopDay.setDate(loopDay.getDate() + 1);
    }

    return results;
  } catch {
    return [];
  }
}
