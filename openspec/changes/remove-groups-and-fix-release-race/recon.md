# Recon: Remove Groups from Sidebar & Fix CI Release Race

## Motivation
1. The operator observed `NullTrace v0.6.37 🔴 Updates not configured`.
   - Root cause: in `.github/workflows/ci.yml`, the `release-macos` job completed early and published the GitHub release before the Windows job finished building NSIS/portable artifacts and `latest.json`. During this ~15-20 minute window, requests to `latest.json` on `releases/latest` returned HTTP 404, which the updater displayed as "Updates not configured".
   - Fix: Removed asset publishing from `release-macos`. The Windows `release` job now downloads the macOS artifact via `actions/download-artifact@v4` and publishes all platform artifacts and `latest.json` atomically in a single release call.
2. The operator requested removing Groups from the sidebar navigation («и слева Groups можешь удалить»).
   - Groups are already managed directly inside the Profiles page via the Groups modal and the group filter dropdown (`All Groups (0) ˅`), making a dedicated top-level sidebar route redundant.
   - Removed `groups` from `NAV_DESTINATIONS`, `type Page`, and the router in `src/renderer/src/App.tsx`.
   - Updated `tests/unit/shellGroups.test.ts` to assert that `trash` remains the dedicated WORKSPACE sibling and `groups` is no longer a separate sidebar destination.

## Files Touched
- `src/renderer/src/App.tsx`: Removed `groups` from `Page` union, `NAV_DESTINATIONS`, router switch, and unused imports (`FolderIcon`, `Groups`).
- `tests/unit/shellGroups.test.ts`: Updated navigation destinations test to reflect removal of Groups from sidebar.
- `.github/workflows/ci.yml`: Made release asset publishing atomic by consolidating macOS and Windows publishing into the final release step.

## Acceptance Criteria
- `tests/unit/shellGroups.test.ts` passes with all 8 tests green.
- Full vitest suite passes.
- Renderer and main TypeScript typecheck pass without errors.
- CI release job publishes all assets atomically with `latest.json`.
