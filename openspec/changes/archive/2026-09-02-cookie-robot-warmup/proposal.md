## Why

Fresh profiles with empty cookie/history stores are a top ban trigger; every commercial antidetect (Afina Cookie Robot, Dolphin, GoLogin) ships a warm-up bot. Our script-engine can express this manually, but there is no turnkey, behavior-plausible warm-up feature.

## What Changes

- Cookie Robot: given a profile + URL list, performs human-like browsing sessions — randomized dwell time, scrolling, link clicks, mouse movement — accumulating cookies, history and localStorage.
- Session policy: max pages, per-site dwell range, per-session duration cap, optional headless; respects profile proxy/fingerprint automatically.
- Runs as a script-engine module today; designed to schedule via `task-groups-queues` when that lands.
- Safety: robots.txt-agnostic but rate-limited; never interacts with login forms; kill switch per run.

## Capabilities

### New Capabilities
- `cookie-robot`: automated warm-up sessions with human-like pacing and auditability.

### Modified Capabilities

None.

## Impact

- New `src/main/scripts/modules/cookieRobot.ts`, input validation, per-run report (pages visited, cookies set, duration); consumes launcher + script-engine.
- Dependency: standalone in wave 1; task-groups integration is wave 2.
