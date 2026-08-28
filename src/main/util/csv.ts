// CSV helpers (Sprint 2.5). Escaping mirrors the import parser in
// api/routes/batch.ts (parseCsv): fields are quoted only when they contain a
// comma, quote, CR or LF, and inner quotes are doubled — so an export
// round-trips through the import parser.
export function escapeCsvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}