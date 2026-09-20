# Recon — remove the sidebar collapse control

Operator: «Убери эту кнопку (свернуть боковую панель) она нам не нужна» → chosen scope:
remove the collapse feature **entirely** (button + Ctrl+B + persisted state + rail CSS).

## Files touched

| File | Change |
|---|---|
| `src/renderer/src/App.tsx` | dropped `sidebarCollapsed` state, `toggleSidebar`, the Ctrl+B keydown effect, the `.collapsed` class, the rail badge variant, the `title` on nav rows, the toggle button, and the `{!sidebarCollapsed && …}` wrapper around the version control; removed the dead `data-tooltip` attribute |
| `src/renderer/src/sidebarLogic.ts` | reduced to `computeRunningCount` + `isEmailTab`; removed `SIDEBAR_COLLAPSED_KEY`, `getStoredSidebarCollapsed`, `persistSidebarCollapsed`, `isToggleShortcut` and the storage guard |
| `src/renderer/src/styles.css` | 26 rules / 126 lines removed (`.sidebar.collapsed *`, `.sidebar-toggle-btn`); removed `--sidebar-w-collapsed`, the `transition: width`, and the pre-existing-dead `.sidebar-footer-controls`; fixed the stale rail-tooltip comment |
| `src/renderer/src/i18n.tsx` | removed `'Toggle sidebar (Ctrl+B)'`, `'Collapse sidebar'`, `'Expand sidebar'`; removed the orphaned `'running'` key |
| `src/renderer/src/theme.ts` | comment referenced the deleted storage guard; corrected |
| `tests/unit/ui/sidebar.test.ts` | dropped the storage + shortcut suites (they tested deleted code); kept `computeRunningCount` |

## Behaviour kept

- Sidebar is a fixed `--sidebar-w` (240px) column at every window size, matching the reference product.
- Nav badge (`runningCount`) still renders in the one remaining layout.
- The version/update control in the footer now renders unconditionally.

## Acceptance check (executed)

| Check | Result |
|---|---|
| `npm run typecheck` | clean (main + renderer) |
| `npx vitest run` (full) | 131 files, 1081 passed / 1 skipped |
| `npm run sbom:verify` | succeeded (562 components) |
| Sidebar width | **240px** measured in the running app |
| Toggle button | absent (`!!document.querySelector('.sidebar-toggle-btn')` → `false`) |
| `.collapsed` elements | **0** in the DOM |
| Ctrl+B (real CDP keypress) | width stays 240px, class stays `sidebar`, `localStorage['sidebar.collapsed']` stays `null` |
| Nav destinations | 7 items, 7 labels visible |
| Footer | `NullTrace v0.6.8` + status line, rendered unconditionally |
| Screenshot | sidebar a fixed column, no control at the bottom, version line at the foot |

Delivered as **v0.6.9**: commit `6c55775`, tag `v0.6.9`, CI green on `main` before the tag.
