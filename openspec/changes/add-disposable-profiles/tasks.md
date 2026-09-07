## 1. Ephemeral Creation & Registry

- [x] 1.1 Implement `POST /profiles/temporary` route and in-memory lifecycle registry.
- [x] 1.2 Implement `.temporary_profiles/<uuid>` directory allocation with isolated cookies and storage.
- [x] 1.3 Add unit tests verifying persistent DB isolation and temporary profile flag handling.

## 2. Multi-Signal Automatic Cleanup

- [x] 2.1 Wire process exit, stop endpoint, and app shutdown cleanup hooks.
- [x] 2.2 Implement non-blocking directory removal with retry mechanism for open file handles on Windows.
- [x] 2.3 Verify cleanup behavior across graceful exit, kill signals, and crash scenarios.

## 3. Startup Orphan Sweep

- [x] 3.1 Implement launcher startup sweep searching and purging orphaned `.temporary_profiles/*` folders.
- [x] 3.2 Ensure persistent profiles and preserved archives are never touched during orphan purges.
