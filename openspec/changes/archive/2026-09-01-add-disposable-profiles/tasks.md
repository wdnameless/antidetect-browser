## 1. Disposable registry and API endpoints

- [x] 1.1 Implement `DisposableProfileRegistry` class in `src/main/profiles/profileManager.ts` managing in-memory temporary profile metadata and directory bindings.
- [x] 1.2 Implement `POST /profiles/temporary` route in `src/main/api/routes/profiles.ts` accepting profile parameters and generating isolated ephemeral descriptors.
- [x] 1.3 Update profile query endpoints to exclude temporary profiles from default listings.

## 2. Directory allocation and containment security

- [x] 2.1 Implement dedicated directory provisioning under `<userDataRoot>/.temporary_profiles/<uuid>` with strict file permission masks.
- [x] 2.2 Implement path containment assertion utilities ensuring deletion targets never escape `.temporary_profiles/` or touch `preserved_browser_data/`.

## 3. Lifecycle cleanup and process traps

- [x] 3.1 Implement browser exit and stop hooks in `src/main/launcher/chromium.ts` to trigger asynchronous recursive folder deletion.
- [x] 3.2 Implement launcher process signal listeners (`SIGINT`, `SIGTERM`, `beforeExit`) to synchronously terminate temporary browser instances and trigger cleanup.
- [x] 3.3 Implement startup purge sweep scanning `.temporary_profiles/` for dead PID locks and orphaned directories.

## 4. Verification and validation

- [x] 4.1 Write Vitest unit tests in `tests/unit/disposable-profiles.test.ts` verifying registry lifecycle, exit deletion, and crash sweep.
- [x] 4.2 Write integration test confirming persistent profile directories and `preserved_browser_data` archives remain untouched during aggressive temporary sweeps.
- [x] 4.3 Run `openspec validate add-disposable-profiles --strict` and confirm zero validation errors.
