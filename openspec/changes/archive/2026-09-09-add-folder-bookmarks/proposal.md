## Why

ShardX links sites to folders: a bookmark added to a folder appears in the bookmark bar of every profile in it (the launcher rewrites its own managed folder per launch, never touching user bookmarks). Operators running client fleets want shared resource links per project without editing each profile.

## What Changes

- New service `src/main/folders/bookmarks.ts`: folder-scoped bookmark registry `[{ folder_id, title, url }]` with CRUD (`/api/v1/folders/:id/bookmarks`).
- On profile launch: the launcher writes a managed `Bookmarks` entry for the profile's folder into the profile's Chromium `Bookmarks` JSON (path: `<user-data-dir>/Default/Bookmarks`): a dedicated managed folder (`"Antidetect"` node), user bookmark data untouched; idempotent rewrite (replace managed node, preserve everything else); file absent → created; invalid JSON → backup once as `Bookmarks.pre-managed.bak` then recreated.
- Launch flag: none — pure pre-launch file merge (runs after Chromium process exit is guaranteed absent, before spawn).
- UI: folder detail view gains "Shared bookmarks" list (add/remove); launch log line reports bookmark sync count.

## Capabilities

### New Capabilities
- `folder-bookmarks`: folder bookmark registry, managed-node merge at launch, UI list.

## Impact

- `src/main/folders/bookmarks.ts` (new), `src/main/launcher/chromium.ts` (pre-launch merge hook), routes in `src/main/api/routes/` (integration owner), `src/renderer/src/pages/Groups.tsx` (list UI), tests in `tests/unit/folderBookmarks.test.ts`.