## 1. Args pipeline

- [x] 1.1 Add `launch_args` column + save-time denylist validation; unit tests (each denied prefix, happy path, empty).
- [x] 1.2 Implement `appendProfileArgs` pure function wired into `buildChromiumArgs` (append last); unit tests for order and verbatim argv.
- [x] 1.3 Profiles editor args input with validation feedback; component check.

## 2. Verification

- [x] 2.1 Full vitest suite + typecheck green; CHANGELOG; `openspec validate add-extra-launch-args --strict`.