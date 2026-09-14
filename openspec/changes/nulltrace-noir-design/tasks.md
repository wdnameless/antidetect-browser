# Tasks — nulltrace-noir-design

Order: tokens → shell → frameless → primitives → page sweep.
Suite stays green (116 files / 921 tests) and typecheck clean throughout.

## 1. Token layer (do first — everything else consumes it)

- [ ] 1.1 Neutralise the remaining hue in `:root`: `--danger`, `--danger-bg`, `--ok`,
      `--ok-bg` must become greyscale. Then sweep the **14** hue literals still
      hardcoded in `styles.css` (all in the preflight/proxy blocks, lines ~706-863:
      `rgba(34,197,94,…)`, `rgba(239,68,68,…)`, `#f87171`) to token references.
- [ ] 1.2 Extend the token layer with what the new components need and what pages
      currently hardcode: surface steps (`--surface-1/2/3`), `--divider` (the hairline
      that survives), control backgrounds, and a radius scale. Rationalise the nine
      current radius values (3/4/6/8/9/10/12/20/50%) onto that scale.
- [ ] 1.3 Remove the orphaned token dialect: inline `var(--bg-secondary, #1e1e24)`-style
      fallbacks in pages and components that reference variables **not defined** in
      `:root`. Those collapse silently during a restyle.
- [ ] 1.4 A test asserting (a) every `var(--x)` referenced anywhere resolves to a
      defined token, and (b) no hue-bearing literal remains in chrome CSS.

## 2. Shell

- [ ] 2.1 Group `NAV` (`App.tsx:53-68`) into WORKSPACE / LIBRARY / SYSTEM with small
      uppercase section labels, ShardX-style. **Nothing may be lost or reordered
      within a group** — the 14 items and their icons stay.
- [ ] 2.2 Restore `scripts` to the navigation: it is in the `Page` union and renders,
      but is absent from `NAV`, so it is currently unreachable by clicking.
- [ ] 2.3 Shared page-header primitive: breadcrumb, title, one-line description,
      right-aligned actions. It replaces the shell's topbar `h1`
      (`App.tsx:236-238`) AND the duplicate per-page `h2`s
      (`Proxies.tsx:156-170`, `Extensions.tsx:104-114`), so no page shows two titles.
- [ ] 2.4 Sidebar footer → ShardX shape: an AUTOMATION API panel with a live status
      dot, the address in monospace and a copy affordance; then the MCP download and
      documentation actions; then the theme toggle; then the version line. Replaces
      the current 20px-radius bordered pill (`styles.css:316`).
- [ ] 2.5 Keep sidebar collapse working exactly as now (`sidebar.collapsed`,
      Ctrl/Cmd+B, `sidebarLogic.ts`) — grouping must not break it.
- [ ] 2.6 i18n for every new visible string, **both `en` and `ru`**.

## 3. Frameless window

- [ ] 3.1 `electron/main.ts` `BrowserWindow` (`:178`) becomes frameless and the
      application menu is removed.
- [ ] 3.2 The app supplies its own draggable header region and
      minimise / maximise / close controls. Verify the window can still be moved,
      minimised, maximised and closed.
- [ ] 3.3 **Preserve tray behaviour and close-to-tray** (`main.ts:189-196`). Verify
      hide-to-tray, tray restore and quit all still work — an unmovable or
      unclosable window is a hard failure, not a cosmetic one.
- [ ] 3.4 The controls are Electron-only. In a browser-served client they must not
      render — a button that does nothing is worse than no button.

## 4. Frames off (R61/R62)

- [ ] 4.1 Remove box borders and elevation from containers: `.table-container`
      (`styles.css:574`), `.panel` (`:1198`), `.modal-card` (`:1144`),
      preflight/proxy boxes (`:786,847,1086,1106`), `.error-banner` (`:1264`).
- [ ] 4.2 Remove borders from controls: `.btn` (`:428`), `.btn-icon` (`:482`),
      `.search-input` (`:399`), `.filter-select` (`:546`), `.input` (`:562`),
      `.segmented-control` (`:1045`), `.preflight-run-icon-btn` (`:756`). Controls
      stay legible by background step and focus state, not by an outline. The user
      chose to drop these too, so verify contrast on the dark ground rather than
      assuming.
- [ ] 4.3 Flatten chips/pills: `.badge` (`:641,656`), `.platform-tag` (`:673`),
      `.license-status` (`:317`), `.nav-badge` (`:229`), `.panel-badge` (`:1214`), and
      the inline chips in `Profiles.tsx:1451,1474,1487` (group/tag/proxy). They
      currently use BOTH a border and a fill; keep only a subtle fill.
- [ ] 4.4 Row action buttons (`Profiles.tsx:1515,1537,1546,1559`) lose their boxes.
- [ ] 4.5 **Keep** the hairline dividers: table row separators, section dividers,
      modal header/footer, sidebar footer edge. This is the line between R61 and R62.
- [ ] 4.6 Semantic states without colour: running/closed, ok/warn/failed must remain
      distinguishable by weight, shape or icon. Verify by looking at them together.
- [ ] 4.7 Operator data colours (profile/tag pickers) are untouched — not chrome.

## 5. Page sweep (worst-first)

- [ ] 5.1 `FlowCanvas.tsx` — largest; also bakes raw hex into inline SVG edge markers
      (`:1285-1307,1349,1395`).
- [ ] 5.2 `Profiles.tsx` — heaviest inline usage.
- [ ] 5.3 `Email.tsx`, `Calendar.tsx`, `Diagnostics.tsx`, `FleetPanel.tsx`
      (`STATUS_COLORS` hex map at `:21-27`).
- [ ] 5.4 Remaining pages onto tokens; shared primitives replace inline re-implementations.
- [ ] 5.5 Empty states consolidated onto one shared primitive (currently several
      inline variants inside `colSpan` cells).

## 6. Verification

- [ ] 6.1 Full suite green, typecheck clean.
- [ ] 6.2 **Look at it.** Start the app (or the served web UI) and screenshot the
      shell and at least the Profiles page; confirm no box borders remain, the
      groups render, and the frameless window can still be moved and closed.
- [ ] 6.3 CHANGELOG entry; README screenshots if any.
- [ ] 6.4 Confirm deferred: no page re-architecture, no light theme (R68i/R69i).

## 7. Deferred (recorded, not scheduled)

- [ ] 7.1 ShardX-style sectioned Profiles form (IDENTITY / LOCALE / PRIVACY / NOISE /
      MEDIA / COOKIES) plus a row of counters — offered, not chosen (R69i).
- [ ] 7.2 Light theme — the product is dark-only.
