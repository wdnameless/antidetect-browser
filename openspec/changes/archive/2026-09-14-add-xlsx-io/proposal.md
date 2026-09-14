## Why

Afina supports .xlsx (Excel) import/export for profiles and proxies. Our CSV import covers the simplest case but loses multi-sheet templates (proxies+profiles in one workbook) and real Excel tooling users' workflows.

## What Changes

- SheetJS-free approach: minimal OOXML reader/writer over `adm-zip` (already in deps) — no new dependency. Single-sheet `.xlsx` with a shared string table; reading tolerates inline strings and shared strings.
- `POST /api/v1/browser-profile/import-xlsx` (same body surface as CSV import) and export endpoints writing `.xlsx` downloads.
- Proxies: import/export `.xlsx` alongside CSV.

## Capabilities

### New Capabilities
- `xlsx-io`: minimal OOXML workbook read/write, profile+proxy import/export roundtrip.

## Impact

- `src/main/io/xlsx.ts` (new), routes in `batch.ts`/`proxy.ts`, UI export/import buttons, tests in `tests/unit/xlsx.test.ts`.