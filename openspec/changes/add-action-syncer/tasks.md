# Tasks: add-action-syncer

## 1. Specs

- [x] 1.1 Write `specs/action-syncer/spec.md` (sessions, mirroring, tiling, hot join/leave, UI)

## 2. Backend (main process)

- [x] 2.1 Schema: `sync_sessions` table (idempotent)
- [x] 2.2 `src/main/util/selectorPath.ts` — stable nth-of-type selector path (pure)
- [x] 2.3 `src/main/syncer/inputDebounce.ts` — 300 ms typing batcher (pure)
- [x] 2.4 `src/main/syncer/actionSyncer.ts` — session store + CDP mirror (bindings, frameNavigated, dispatchMouseEvent/insertText, dead-slave pruning, isSlave flag)
- [x] 2.5 `src/main/syncer/windowTiler.ts` — 2x2/3x3/auto grids via Browser.setWindowBounds
- [x] 2.6 `src/main/launcher/chromium.ts` — export getRunningRec (windowId for tiling)
- [x] 2.7 `src/main/api/routes/syncer.ts` + wire into `server.ts`

## 3. Frontend (renderer)

- [x] 3.1 Sync button in the Profiles bulk bar (≥2 selected running profiles) + session creation
- [x] 3.2 Active-session panel: participants (master badge), status, Tile 2x2/3x3, Stop, Join/Leave
- [x] 3.3 i18n EN/RU strings

## 4. Tests

- [x] 4.1 `tests/unit/selectorPath.test.ts` — path builder + matching
- [x] 4.2 `tests/unit/inputDebounce.test.ts` — batching, flush timers, no re-entrancy

## 5. Verification

- [x] 5.1 `npm run typecheck` (main + renderer) passes
- [x] 5.2 `npx vitest run` — all green (88 pre-existing + new)
- [x] 5.3 `openspec validate add-action-syncer` passes