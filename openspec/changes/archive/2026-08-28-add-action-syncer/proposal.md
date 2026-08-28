# Proposal: add-action-syncer

## Why

Operators routinely run the same flow (login, navigation, form fill) in many profiles at once. Today each profile window must be driven manually, one by one — slow and error-prone. Sprint 3 adds group action synchronization: one master profile's actions (navigation, clicks, typing) are mirrored in real time to every other running profile in a sync session, plus automatic window tiling so all participants stay visible on one screen.

## What Changes

- **Sync sessions (3.1)**: new `sync_sessions` table (id, master_profile_id, created_at, status, members JSON). API: `POST /sync/sessions {profile_ids[]}` (all members must be running, otherwise `NOT_RUNNING`; Firefox/Camoufox profiles are rejected with `UNSUPPORTED`), `GET /sync/sessions` (active), `POST /sync/sessions/:id/stop`. Master = first profile in the list, the rest join as slaves.
- **Action mirroring (3.2)**: new `src/main/syncer/actionSyncer.ts`. Master CDP session subscribes to `Page.frameNavigated` (navigation) and, via `Runtime.addBinding` + a capture-phase JS listener injected in the MAIN world, intercepts clicks (coordinates + selector-path) and input/change (value + selector-path). Slaves replay: navigation through `Page.navigate`; clicks ONLY through `Input.dispatchMouseEvent` (mousePressed/mouseReleased, coordinates re-scaled to the slave viewport — never `Runtime.evaluate` clicks, which are detectable); typing through `Input.dispatchKeyEvent` / `Input.insertText`. A stable selector path (nth-of-type chain) is built for every element; in a slave the element is located via `querySelector` first, falling back to master viewport coordinates. Master events are never re-injected into the master; slave windows are injected with an `isSlave` flag so their own events never cascade. Typing is debounced 300 ms and sent as a batch on change/blur, not per keypress.
- **Window tiling (3.3)**: new `src/main/syncer/windowTiler.ts` — grids 2x2 / 3x3 / auto positioning each profile window through CDP `Browser.setWindowBounds`. API: `POST /sync/tile {session_id, layout}`.
- **Hot join/leave (3.4)**: `POST /sync/sessions/:id/join {profile_id}` and `POST /sync/sessions/:id/leave` operate live without restarting the session.

## Impact

- **Affected specs**: new capability `action-syncer` (no existing specs modified).
- **Affected code**:
  - `src/main/db/schema.ts` — one new table `sync_sessions` (idempotent).
  - new `src/main/syncer/actionSyncer.ts` (session lifecycle + CDP mirror) and `src/main/syncer/windowTiler.ts`; new `src/main/util/selectorPath.ts` (stable selector-path builder, pure and unit-testable) and `src/main/syncer/inputDebounce.ts` (300 ms typing batcher, pure).
  - `src/main/launcher/chromium.ts` — export `getRunningRec` (windowId for tiling); reuses existing `isRunning`/`getRunningWs` — no changes to the start/stop pipeline.
  - `src/main/api/server.ts` + new `routes/syncer.ts`.
  - Renderer: Sync button in the Profiles bulk bar (enabled for ≥2 selected running profiles), floating active-session panel (participants with master badge, status, Tile 2x2/3x3, Stop, Join/Leave); i18n EN/RU.
- **Non-goals**: cookie/storage sync, drag-and-drop mirroring, mouse wheel/scroll mirroring, Firefox/Camoufox support (explicit `UNSUPPORTED`), session persistence across service restarts (active sessions are dropped on restart), cross-machine sync.