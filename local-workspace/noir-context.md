# Noir design wave — nulltrace-noir-design

## Goal
Monochrome noir redesign modelled on ShardX: one neutral token layer, boxes removed (thin dividers kept), grouped sidebar, one page-header primitive, frameless window, ShardX-shaped sidebar footer.

## User decisions (2026-09-14)
- **Scope**: design system + rebuild of the existing pages. Structure stays; appearance and shell change. Page re-architecture is explicitly NOT in scope.
- **Frames**: «Убрать коробки, оставить только тонкие разделители» — remove full-perimeter borders from containers/controls/chips; KEEP horizontal hairline dividers (table rows, section breaks, modal head/foot, sidebar footer edge).
- **Window**: frameless — no native title bar, no `File/Edit/View/Window` menu. App supplies drag region + controls.
- **Footer**: AUTOMATION API block like ShardX — status dot, monospace address, copy, then MCP download + documentation, then theme toggle, then version.
- Monochrome only: no hue in chrome.

## Verified inventory (reconnaissance — trust these)

### Token layer — `src/renderer/src/styles.css:1-29`, ~30 vars, ALREADY greyscale
`--bg-app #09090b`, `--bg-sidebar #0d0d10`, `--bg-header #0d0d10`, `--panel #141417`, `--panel-hover #1a1a1e`, `--panel-2 #1c1c1f`, `--border rgba(255,255,255,0.09)`, `--border-focus rgba(255,255,255,0.55)`, `--text #fafafa`, `--text-secondary #a1a1aa`, `--text-muted #71717a`, `--accent #ffffff`, `--accent-hover #e4e4e7`, `--accent-gradient`, shadows, `--font-sans/mono`, `--radius-sm 6px`, `--radius-md 8px`, `--radius-lg 12px`.
`--danger`/`--danger-bg`/`--ok`/`--ok-bg` have already been neutralised to greyscale.

### 14 hue literals REMAIN in styles.css (~lines 706-863, preflight/proxy blocks)
`rgba(34,197,94,…)` ×3, `rgba(239,68,68,…)` ×8, `#f87171` ×2, and one `#f87171` border-left at `:863`.

### HAIRLINES to KEEP
`styles.css:63` sidebar right, `:302` sidebar-footer top, `:343` header bottom, `:588` table thead, `:603` table td, `:842`/`:954` preflight, `:1008` modal-tabs, `:1160` modal-header, `:1177` modal-footer, `:1235` setting-row; `FleetPanel.tsx:133,172`; `SyncPanel.tsx:230`.

### BOX BORDERS to REMOVE
Panels/cards: `.table-container :574`, `.panel :1198`, `.modal-card :1144`, preflight/proxy boxes `:786,847,1086,1106`, `.error-banner :1264`.
Controls: `.btn :428`, `.btn-icon :482`, `.search-input :399`, `.filter-select :546`, `.input :562`, `.segmented-control :1045`, `.preflight-run-icon-btn :756`.
Chips/pills: `.badge :641,656`, `.platform-tag :673`, `.license-status :317`, `.nav-badge :229`, `.panel-badge :1214`; inline in `Profiles.tsx:1451` (proxy), `:1474` (group), `:1487` (tag).
Row actions: `Profiles.tsx:1515` (play/stop), `:1537` (preflight), `:1546` (edit), `:1559` (kebab).

### Radius values in use (rationalise onto a scale)
3px `:1063,976` · 4px `:124,674,695,757,942,1252`, `Profiles.tsx:1451,1487` · 6px/`--radius-sm` `:200,272,480,925,1054`, `Profiles.tsx:1577` · 8px/`--radius-md` `:144,400,427,549,565,785,848,1043,1075,1107,1215,1267` · 9px `:104` · 10px `:233`, `SyncPanel.tsx:126` · 12px/`--radius-lg` `:575,1145,1199` · 20px `:316,633` · 50% `:256,324,648,663`.

### Shell — `src/renderer/src/App.tsx`
- `Page` union (`:45`), 15 members: profiles, groups, proxies, devices, extensions, email, teams, cloud, diagnostics, trash, scripts, catalog, flows, settings, calendar.
- `NAV` (`:53-68`), **14 items** in order with icons: profiles(ProfilesIcon), groups(FolderIcon), proxies(ProxiesIcon), devices(DevicesIcon), extensions(ExtensionsIcon), email(ShieldIcon), diagnostics(KeyIcon), trash(TrashIcon), flows(FlowIcon), calendar(CalendarIcon), catalog(CookieIcon), teams(UsersIcon), cloud(CloudIcon), settings(SettingsIcon).
- **`scripts` is in `Page` and renders (`:276-277`) but is MISSING from `NAV`** — currently unreachable by clicking. Restore it.
- Sidebar `:164-232`; brand `:168-175`; nav `:177-219`; workspace switcher `:221-223`; footer `:225-231`; main `:234-293`; topbar `:235-257` (renders `<h1 class="page-title">` at `:236-238`); content-area `:259-292`; page switch `:260-291`.
- Collapse: `sidebarLogic.ts` (`sidebar.collapsed`, Ctrl/Cmd+B); state `App.tsx:75`, listener `:103-120`, class `:165`.

### Duplicate titles to remove
Shell renders `h1.page-title` (`App.tsx:236-238`); `Proxies.tsx:156-170` and `Extensions.tsx:104-114` each render their own `h2`. `Profiles.tsx:1230-1335` renders NO title (filters + actions only).

### Empty states (several inline variants, all inside `colSpan` cells)
`Profiles.tsx:1367-1393` (two branches), `Proxies.tsx:317-329`, `Extensions.tsx:182-194` — each centres an icon at `opacity 0.3` + title + explanation + CTA.

### i18n
`i18n.tsx`: the English string IS the key; `RU` dictionary maps it (`:7-550`); `t()` returns `RU[s] ?? s` (`:569`). Both languages required for any new visible string.

## Constraints
1. No hue anywhere in chrome. Operator-chosen data colours (profile/tag pickers) are NOT chrome — leave them.
2. Semantic states must stay distinguishable without colour (weight/shape/icon), verified by looking at them together.
3. No new dependency, no CSS framework.
4. Never rename `HMAC_SECRET`, `SIGNING_DOMAIN_PREFIX`, `DATA_DIR`, `DB_PATH`, `ANTIDETECT_*`, `appId`.
5. Run only your own test files. Never the full suite.
6. No `any`, no `@ts-ignore`.

## Return contract (≤25 lines)
```
STATUS: <done|partial|blocked>
FILES: <paths only>
TESTS: <file> — was X → now Y
INTERFACES: <public signatures added/changed>
REQUIREMENTS: <R-id mapping>
CONCERNS: <decisions needed, or files you needed but did not own>
```
