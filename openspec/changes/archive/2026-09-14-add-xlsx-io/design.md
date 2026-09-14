# Design: XLSX IO

## Key Decisions

1. **Hand-rolled minimal OOXML over adm-zip**: SheetJS pulls a large dep tree for a one-sheet format; a ~200-line writer (workbook.xml, sheet1.xml, [Content_Types].xml, sharedStrings.xml) + reader covering inline strings and shared strings handles the import/export contract. A conforming workbook opens in Excel/LibreOffice.
2. **Deterministic output**: sorted headers, ISO dates, stable column order per sheet.
3. **Reader is strict**: unknown cell types fail with a typed error, never a silent empty cell.
4. **No external style**: we emit a plain table; formatting is the user's spreadsheet app's job.

## Testing Strategy

- `tests/unit/xlsx.test.ts`: writer roundtrip (write → reopen with adm-zip → parse XML → match input rows), reader on both inline-string and shared-string fixtures (fixture bytes built in the test, not on disk), invalid archive rejection, export-then-import of a profile list preserves names/timezones/hosts.
