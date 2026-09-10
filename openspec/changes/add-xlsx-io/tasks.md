## 1. Writer and reader

- [ ] 1.1 Implement minimal OOXML writer (workbook + sheet + shared strings) and reader (inline + shared strings) in `src/main/io/xlsx.ts`; unit tests per design.
- [ ] 1.2 Add profile/proxy import + export routes using the existing CSV conventions; route tests.
- [ ] 1.3 UI export/import buttons next to CSV in Profiles and Proxies pages.

## 2. Verification

- [ ] 2.1 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-xlsx-io --strict`.
