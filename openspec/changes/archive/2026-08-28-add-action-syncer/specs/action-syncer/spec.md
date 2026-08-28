# action-syncer delta

## ADDED Requirements

### Requirement: Sync session lifecycle

The system SHALL store sync sessions in `sync_sessions` (id, master_profile_id, created_at, status, members JSON). Creating a session (`POST /api/v1/sync/sessions` with `{profile_ids: [...]}`) SHALL require every profile to be a RUNNING Chromium profile; otherwise the API SHALL answer `code:"NOT_RUNNING"` (not running) or `code:"UNSUPPORTED"` (Firefox/Camoufox). The first profile in the list becomes the master, the rest become slaves. `GET /api/v1/sync/sessions` SHALL list active sessions; `POST /api/v1/sync/sessions/:id/stop` SHALL detach all CDP listeners and mark the session stopped.

#### Scenario: Create a session from running Chromium profiles

- **WHEN** the user posts two or more running Chromium profile ids
- **THEN** a session row is created with `master_profile_id` = the first id, `status='active'` and `members` containing the remaining ids
- **AND** each slave receives the mirror injection (navigate, click, input)

#### Scenario: Not-running profile is rejected

- **WHEN** one of the posted profile ids is not running
- **THEN** the response is `code:"NOT_RUNNING"` and no session is created

#### Scenario: Firefox profile is rejected

- **WHEN** a posted profile id belongs to a Firefox/Camoufox profile
- **THEN** the response is `code:"UNSUPPORTED"` and no session is created

#### Scenario: Stop a session

- **WHEN** the user stops a session
- **THEN** all CDP bindings/listeners are detached, slaves are cleared and the row status becomes `stopped`

### Requirement: Action mirroring

The system SHALL mirror master actions to slaves through CDP: `Page.frameNavigated` → `Page.navigate`; intercepted clicks → `Input.dispatchMouseEvent` (mousePressed + mouseReleased, coordinates re-scaled to the slave viewport); typed input → `Input.dispatchKeyEvent` / `Input.insertText` as a batch (300 ms debounce on change/blur). Every element reference uses a stable selector path (nth-of-type chain); a slave first resolves it via `querySelector` to compute target coordinates and falls back to the master viewport coordinates. Master events SHALL never be re-injected into the master, and slave pages SHALL be flagged (`isSlave`) so mirrored actions do not cascade back into the session.

#### Scenario: Navigation is mirrored

- **WHEN** the master navigates to a URL
- **THEN** every live slave navigates to the same URL

#### Scenario: A click is replayed as real input

- **WHEN** the user clicks a button in the master
- **THEN** each slave receives mousePressed/mouseReleased at the target element (resolved by selector path, scaled to its viewport) — not a scripted JS click

#### Scenario: Typing is batched, not per keypress

- **WHEN** the user types into a master field and leaves it (change/blur) or pauses >300 ms
- **THEN** slaves receive the final value as a single input batch (select-all + insertText / clear + insertText), not one keypress event at a time

#### Scenario: Dead slave drops out silently

- **WHEN** a slave's browser is closed mid-session
- **THEN** the mirror logs the failure and removes the profile from the session members without interrupting the other participants

#### Scenario: No event cascade

- **WHEN** a slave replays a master click/typing
- **THEN** the slave's own input events are ignored by the session (isSlave flag + master-only event source), so actions do not ping-pong

### Requirement: Window tiling

The system SHALL position the browser windows of a session's participants into a grid layout (2x2, 3x3, or auto = smallest fitting grid) through CDP `Browser.setWindowBounds`, triggered by `POST /api/v1/sync/tile {session_id, layout}`.

#### Scenario: Tile a session 2x2

- **WHEN** the user requests the 2x2 layout for an active session
- **THEN** each participant window is resized/moved to its grid cell (equal shares of the work area)

#### Scenario: Auto layout

- **WHEN** the user requests the auto layout
- **THEN** the smallest grid that fits all participants (1xN for ≤2, 2x2 for ≤4, 3x3 for ≤9) is applied

### Requirement: Hot join and leave

The API SHALL support adding (`POST /api/v1/sync/sessions/:id/join {profile_id}`) and removing (`POST /api/v1/sync/sessions/:id/leave {profile_id}`) a running Chromium profile to/from an active session without restarting it.

#### Scenario: Join mid-session

- **WHEN** a running Chromium profile joins an active session
- **THEN** it is added to members and starts receiving mirrored actions immediately

#### Scenario: Leave mid-session

- **WHEN** a member leaves (or is the last one besides the master)
- **THEN** it stops receiving actions; the session keeps running for the rest, or auto-stops when no slaves remain

### Requirement: Sync UI

The renderer SHALL provide a Sync button in the Profiles bulk bar (enabled when ≥2 selected profiles are running) that creates a session, and an active-session panel listing participants (master badge), session status, Tile 2x2 / 3x3 buttons, Stop, and per-profile Join/Leave — in the existing monochrome style with EN/RU strings.

#### Scenario: Operator starts and stops a sync from the UI

- **WHEN** the operator selects ≥2 running profiles and clicks Sync
- **THEN** the session panel appears; clicking Stop ends it and the panel closes

#### Scenario: Operator tiles the windows

- **WHEN** the operator clicks Tile 2x2 in the session panel
- **THEN** the participant windows are arranged in a 2x2 grid