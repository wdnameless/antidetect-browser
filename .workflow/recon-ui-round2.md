# Recon — five operator reports (dropdowns, table scroll, MCP panel, Library tabs, taskbar icon)

Lane T1. Measured 2026-09-20 against the source tree and the running 0.6.20 portable.

## 1. Dropdowns read as native and render with broken colours

- `src/renderer/src/components/Dropdown.tsx` exists and is **imported nowhere** (`grep '<Dropdown'` →
  0 hits). It emits `dropdown`, `dropdown-trigger`, `dropdown-menu`, `dropdown-item`,
  `dropdown-hint`, `dropdown-placeholder`.
- `styles.css` contains **no rule for any of those class names** — `grep -n 'dropdown'` → 0 hits.
  So the one styled-select component in the tree has never been rendered, and has no style to
  render with.
- The same holds for `components/Menu.tsx`: `.menu-wrap`, `.menu`, `.menu-item`, `menu-left` have
  no rules either.
- Every select in the app is a bare native `<select>` (~30 call sites). On WebView2 the popup list
  is drawn by the OS: light system colours over a `#09090b` app, which is the "broken colours /
  looks like a classic native control" report.
- The filter toolbar in `Profiles.tsx` overrides the trigger inline (`background: transparent;
  border: none; border-radius: 0`) but cannot reach the popup.

## 2. Horizontal scroll in the profiles table

- `.table-container { overflow-x: auto }` + `.table--wide { min-width: 1080px }` is the scrollbar
  the operator sees. `.col-actions` is `position: sticky; right: 0` — a workaround that exists only
  to keep the actions column visible *while that scroll is happening*.
- Profiles column widths are hard-coded percentages (`40% / 28% / 14% / 18%`) on `<th>`, with
  `table-layout: auto`, so a long profile name pushes the table past the container and the scroll
  appears instead of the column shrinking.

## 3. MCP panel

- `AutomationPanel.tsx` renders **three** buttons: `MCP: Off|On|{n} tools` (a start/stop toggle),
  `Download MCP`, `Documentation`.
- The operator asked for two buttons and for MCP to be a **status**, not a control: installed+running
  → "enabled, N tools"; not installed → the Download button is the affordance.
- Nothing records that a bundle was written. `POST /api/v1/mcp/bundle` returns `dir` and forgets it,
  so "already downloaded and installed" is not answerable today. Fix: persist the folder
  (`setSetting('mcpBundleDir', …)`, the mechanism already used for `catalogUrl` / `mcpScope`) and
  report `installed` / `bundleDir` in `GET /api/v1/mcp/status` (existence re-checked per request,
  so a deleted folder stops claiming installed).

## 4. Library tabs

- `App.tsx` `email` destination carries `subTabs: [email, calendar, catalog]`, plus `Page` members
  `'catalog' | 'calendar'`, imports of `pages/Catalog.tsx` and `pages/Calendar.tsx`, and two render
  branches. `cronProjection.ts` + `tests/unit/cronProjection.test.ts` exist only for `Calendar.tsx`.
- Renderer API surface to prune: `catalogFetch`, `catalogCode`, `catalogInstall`, `catalogGetUrl`,
  `catalogSetUrl`, `CatalogScriptItem`. The backend `/api/v1/catalog` routes and
  `src/main/scripts/scriptCatalog.ts` stay (public API surface, OpenAPI-documented).
- `Scripts.tsx` empty state says "create one or install from the Catalog." — unreachable destination
  after the removal, so the sentence goes.

## 5. Taskbar icon is blurred — measured, not inferred

`WM_GETICON` on the live window (`temp/wicon.py`, read-only):

```
{'title': 'NullTrace', 'small': '16x16 bpp=32', 'big': 'none', 'small2': '16x16 bpp=32'}
system dpi: 96; SM_CXICON=32 SM_CYICON=32
```

The window holds **only a 16×16 bitmap** and no `ICON_BIG`, while the taskbar draws at 32×32 —
Windows upscales 16→32. That is the blur.

Cause, traced through the pinned dependency sources:

- `tauri-codegen-2.6.3/src/image.rs` `CachedIcon::new_ico` takes `icon_dir.entries()[0]` and decodes
  **that one frame** into a single RGBA bitmap — the multi-size `.ico` is collapsed to its first
  entry.
- `icons/icon.ico` is written by Pillow (`generate-icons.py`, `master_1024.save(path, format='ICO',
  sizes=…)`), and `PIL/IcoImagePlugin._save` iterates `sorted(set(sizes))` — **ascending**, so
  entry 0 is 16×16. Verified by parsing the directory: `[(16, png), (20, png), …, (256, png)]`.
- `tao-0.35.3` applies that bitmap as `IconType::Small` only
  (`platform_impl/windows/window.rs:882`); `ICON_BIG` is set by `set_taskbar_icon`, which Tauri does
  not expose.

So the single fix that addresses the measured defect: emit the `.ico` with the **largest frame
first**. `entries[0]` then decodes to 256×256, the shell holds a 256 HICON in the small slot and
downscales to whatever the taskbar/Alt-Tab/DPI needs instead of upscaling a 16 px bitmap.

## Files to touch

| File | Change |
|---|---|
| `src/renderer/src/styles.css` | `.dropdown*` + `.menu*` rules; `select option` theme fallback; `table-layout: fixed` + resize handle; drop `overflow-x`/`min-width`/sticky `.col-actions` |
| `src/renderer/src/components/Dropdown.tsx` | keyboard/escape/disabled handling; used by the toolbar and page filters |
| `src/renderer/src/useColumnResize.ts` (new) | pointer-drag column widths, persisted per table |
| `src/renderer/src/pages/Profiles.tsx`, `pages/Proxies.tsx` | colgroup + resizable headers; Dropdown filters |
| `src/renderer/src/components/AutomationPanel.tsx`, `src/main/api/routes/mcp.ts` | two buttons + MCP status with installed flag |
| `src/renderer/src/App.tsx`, `pages/Calendar.tsx`, `pages/Catalog.tsx`, `cronProjection.ts`, `api.ts`, `i18n.tsx`, `Scripts.tsx` | Library = Email only |
| `scripts/generate-icons.py` | `.ico` container writer with the largest frame first |
| `src-tauri/icons/icon.ico`, `assets/brand/*.ico`, `build/icon.ico` | regenerated |

## Acceptance check

- A dropdown opens as an app-styled panel (dark surface, hover, check mark) in both themes; no
  native popup.
- The profiles table has no horizontal scrollbar at 1280×800; each column drags wider/narrower with
  the width surviving a reload.
- MCP row shows exactly two buttons; a recorded bundle folder reports installed + tool count, and a
  deleted folder stops reporting it.
- Library shows only Email; `npm run typecheck` and `npm test` clean.
- `icon.ico` entry 0 decodes to 256×256 and all nine sizes are still present.
