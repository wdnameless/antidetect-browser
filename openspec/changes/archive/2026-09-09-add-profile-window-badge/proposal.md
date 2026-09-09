## Why

ShardX gives each profile window a platform-specific badge with the profile's name and color (`--shardx-profile-color`), letting operators distinguish dozens of windows in the taskbar. Our windows are visually identical — operators running 10+ profiles rely on window titles only.

## What Changes

- Profile schema: nullable `color` column (hex) + optional `badge` flag; profile create/update endpoints accept `color`.
- On profile launch: renderer-side badge generation (canvas-drawn badge: profile color background, initials/name overlay, cached PNG per profile+color) passed to the launched window via Electron `BrowserWindow` overlay icon (`setOverlayIcon`) — but profile browsers are raw Chromium processes, not Electron windows, so the badge is applied to the **launcher's taskbar grouping** and the profile's **window title prefix** (`[badge] name — page`), plus an iconized `.ico` per profile passed via `--user-data-dir`-bound shortcut for pinned taskbar entries on Windows.
- Profiles page: color picker + badge preview in profile editor; color dot column in the table.

## Capabilities

### New Capabilities
- `profile-window-badge`: per-profile color identity, badge generation, launch-time application, editor/table UI.

## Impact

- `src/main/profiles/profileManager.ts` (schema + endpoints), `src/renderer/src/pages/Profiles.tsx` (picker, dot column, preview), badge renderer util in renderer, tests in `tests/unit/profileBadge.test.ts`.
- Raw Chromium windows cannot receive overlay icons directly — title-prefix + pinned-shortcut approach is the Windows-honest path; the slice documents this limitation explicitly.