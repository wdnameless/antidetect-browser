## 1. Mover service and API

- [x] 1.1 Implement `moveDataRoot` (gate, pre-count, copy+progress+cancel, verify, DB-last swap, path rewrite, old-root cleanup) with injectable fs seams; sandbox unit tests per design's six scenarios.
- [x] 1.2 Add routes `POST /api/v1/settings/data-root/move`, `GET .../move/status`, `POST .../move/cancel`; route tests (gate errors, phase transitions).
- [x] 1.3 Settings "Data Folder" move flow (progress bar, cancel, error states); component check.

## 2. Verification

- [x] 2.1 Full vitest suite + typecheck green; CHANGELOG; `openspec validate add-movable-data-root --strict`.