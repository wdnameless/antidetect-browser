## 1. Registry and merge

- [x] 1.1 Implement folder bookmark registry CRUD (JSON column on groups, zod validation); unit tests for validation and persistence.
- [x] 1.2 Implement managed-node merge (pre-spawn hook): replace `Antidetect` node, preserve user data, corruption `.bak` policy; sandbox tests per design's six scenarios.
- [x] 1.3 Groups page "Shared bookmarks" list UI; launch log line with sync count; component check.

## 2. Verification

- [x] 2.1 Full vitest suite + typecheck green; CHANGELOG; `openspec validate add-folder-bookmarks --strict`.