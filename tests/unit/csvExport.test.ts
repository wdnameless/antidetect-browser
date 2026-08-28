import { describe, it, expect } from 'vitest';
import { escapeCsvField, toCsv } from '../../src/main/util/csv';

/**
 * The import parser (api/routes/batch.ts parseCsv) is the round-trip contract:
 * quoted fields, doubled inner quotes, comma-separated values. We re-implement
 * its line parser here (copied verbatim) to prove the export parses back.
 */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

describe('csv export (Sprint 2.5)', () => {
  it('does not quote plain values', () => {
    expect(escapeCsvField('simple')).toBe('simple');
    expect(escapeCsvField('')).toBe('');
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('quotes values with commas, quotes and newlines (doubles inner quotes)', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('cr\rlf')).toBe('"cr\r lf"'.replace(' ', ''));
  });

  it('round-trips through the parseCsv-style parser', () => {
    const rows = [
      ['p_1', 'normal', 'windows', 'socks5://1.2.3.4:1080', 'g_1', 'tagA|tagB', '2026-08-28T00:00:00.000Z'],
      ['p_2', 'with, comma', 'macos', '', '', '', '2026-08-28T01:00:00.000Z'],
      ['p_3', 'with "quotes" and, comma', 'linux', 'http://h:1', 'g_2', 'tag "X"', ''],
    ];
    const csv = toCsv(['id', 'name', 'platform', 'proxy', 'group', 'tags', 'created_at'], rows);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('id,name,platform,proxy,group,tags,created_at');
    // every row must parse back to the original values
    for (let i = 1; i < lines.length; i++) {
      const parsed = parseLine(lines[i]);
      expect(parsed).toEqual(rows[i - 1]);
    }
  });

  it('header-only export for an empty list', () => {
    const csv = toCsv(['id', 'name'], []);
    expect(csv).toBe('id,name\r\n');
  });

  it('numbers and dates are stringified', () => {
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(new Date('2026-01-01T00:00:00Z'))).toBe(new Date('2026-01-01T00:00:00Z').toString());
  });
});