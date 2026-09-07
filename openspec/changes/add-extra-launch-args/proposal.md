## Why

ShardX appends per-profile extra launch arguments after the launcher's defaults, so power users can toggle experimental Chromium switches per profile without a settings table. Our `buildChromiumArgs` produces a fixed set; experimentation requires editing launcher code.

## What Changes

- Profile schema: nullable `launch_args` (JSON string array) accepted by create/update.
- `buildChromiumArgs` appends `launch_args` **last** (after all launcher defaults and stealth flags) so user switches override defaults — e.g. `--disable-quic`, `--blink-settings=imagesEnabled=false`.
- Safety denylist: args whose value strings contain `--fingerprint*`, `--remote-debugging*`, `--user-data-dir`, `--proxy-server`, `--load-extension` are rejected at save time (they would break stealth or isolation invariants); rejection lists the denied token.
- Profiles editor: args editor (one per line) with validation feedback.

## Capabilities

### New Capabilities
- `extra-launch-args`: per-profile appended switch list, denylist validation, editor surface.

## Impact

- `src/main/profiles/profileManager.ts` (column + validation), `src/main/launcher/chromium.ts` (append + unit-testable pure function), `src/renderer/src/pages/Profiles.tsx` (editor), tests in `tests/unit/launchArgs.test.ts`.