# Interfaces — ui-density-redesign

Written by the orchestrator BEFORE any Wave 3 spawn. Every subagent reads this by path.
One writer per file; zones below are disjoint by construction.

## Zone ownership (no two agents write the same file)

| Zone | Owner | Files |
|---|---|---|
| A. Tokens + shell | `TokensShell` | `src/renderer/src/styles.css` (token block + shell sections only), `src/renderer/src/App.tsx` |
| B. Brand icon | `BrandIcon` | `assets/brand/*`, `scripts/generate-app-icon.mjs`, `src/renderer/src/icons.tsx` (BrandMark only) |
| C. Dense tables | `DenseTables` | `src/renderer/src/pages/Profiles.tsx`, `Proxies.tsx`, `Devices.tsx`, `Extensions.tsx`, `Groups.tsx`, `Trash.tsx` |

Zone A owns the stylesheet exclusively. Zone C must NOT edit `styles.css` — it emits
class names that Zone A defines. The class-name contract below is frozen before spawn.

## Frozen class-name contract (Zone A defines, Zone C consumes)

Zone C must use EXACTLY these names and no new bespoke styling:

```
.row-dense          — the single-line row container; fixed height var(--row-h)
.row-dense__lead    — left slot: checkbox + primary label + secondary meta
.row-dense__meta    — middle slots: proxy / os / fingerprint, all one line, muted
.row-dense__status  — status chip slot
.row-dense__actions — right slot; hidden until :hover or :focus-within
.row-dense__check   — batch-selection checkbox cell; ALWAYS visible (never hover-gated)
.row-dense__group   — group/tag chip slot, collapsed to an icon+tooltip at this height
```

Both tables are real `<table>` elements (`Profiles.tsx:1352`, `Proxies.tsx:309`), so a row
is a `<tr>`. Density comes from row height and padding, NOT from abandoning the table:
column alignment must survive, because Proxies is a multi-column grid (host, port,
protocol, country, latency, status) where ragged flex layout would break scanning.

Rules that make density real:
- `--row-h: 52px` (within the 48–56px the user chose) is the ONLY row height.
- `.row-dense__actions` is `opacity: 0` and becomes `1` on `:hover` / `:focus-within`.
  It must stay reachable by keyboard: never `display:none`.
- `.row-dense__check` is NOT hover-gated: batch selection is a primary operation and a
  checkbox that appears only on hover cannot be used by keyboard or touch (R02, R14i).
- Every focusable control in a row MUST have a visible `:focus-visible` ring. Today the
  stylesheet contains **zero** `:focus-visible` rules; that is a defect to fix, not a
  licence to inherit the browser default. The hidden-actions pattern must not add 4
  invisible tab stops per row — the row's actions become tabbable only when the row is
  focused, so keyboard traversal stays proportional to row count, not to action count.
- Secondary meta uses `--text-muted`; the primary label uses `--text`.
- No full-perimeter border on a row. One `border-bottom: 1px solid var(--divider)`.

## Token contract (Zone A publishes; both other zones consume; nobody invents)

Existing names are KEPT so nothing breaks. Additions only, plus the spacing scale that
does not exist today.

```
/* existing, unchanged semantics */
--bg-app --bg-sidebar --bg-header --panel --panel-hover --panel-2
--surface-1 --surface-2 --surface-3 --divider --border
--control-bg --control-bg-hover --control-bg-active --control-bg-selected
--text --text-secondary --text-muted
--accent --accent-hover
--radius-none --radius-sm --radius-md --radius-lg --radius-full
--shadow-sm --shadow-md --shadow-lg

/* NEW — the missing spacing scale (R06). 4px base, named by step not by pixel. */
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-5: 24px;  --space-6: 32px;  --space-7: 48px;

/* NEW — density + shell metrics, so no component hardcodes a height again (R03) */
--row-h: 52px;
--control-h: 32px;
--control-h-sm: 28px;
--sidebar-w: 232px;
--sidebar-w-collapsed: 52px;
--topbar-h: 48px;

/* NEW — type scale (R06). Named by role, not by size. */
--text-xs: 11px;  --text-sm: 12px;  --text-base: 13px;
--text-lg: 15px;  --text-xl: 18px;
--leading-tight: 1.25; --leading-normal: 1.45;
```

Hard rules for all zones:
- No literal hex in `.tsx`. Chrome colours resolve through `var(--…)`. The existing
  `tests/unit/noirTokens.test.ts` guard enforces this and must stay green.
- No `!important`. The two existing ones are deleted, not preserved.
- Operator data colours (profile/tag pickers) are exempt — they live in the dedicated
  palette module the guard already excludes (R13i).

## Navigation contract (Zone A implements; the taxonomy is frozen)

Seven top-level items; every one of today's 15 destinations stays reachable (R01, R02).

| # | Top-level | Sub-tabs (previously separate nav items) |
|---|---|---|
| 1 | Profiles | Groups, Trash |
| 2 | Proxies | — |
| 3 | Browser | Devices, Extensions |
| 4 | Automation | Flow Canvas, Scripts |
| 5 | Library | Email, Calendar, Catalog |
| 6 | Cloud | Cloud Sync, Teams |
| 7 | Settings | Diagnostics |

`Page` union as it exists today (`App.tsx:45`) — 15 members, all must stay reachable:

```
profiles groups proxies devices extensions email teams cloud
diagnostics trash scripts catalog flows settings calendar
```

**Correction found by the G2 omission check:** `security` and `license` are NOT members of
`Page`. They are internal `Section` state inside `Settings.tsx` (~:334). Diagnostics IS a
`Page` and becomes a Settings sub-tab, but Security and License must stay reachable through
their existing in-page tab strip — the shell must NOT try to route to them as pages. Wiring
`'security' | 'license'` into the shell would not compile.

Sub-tabs render as a horizontal tab strip inside the page, driven by the existing
`Page` union — no router is introduced. A top-level item with no sub-tabs renders no strip.
Badge counters stay on Profiles (running count) and Cloud (sync dot).

**Correction found by the `NavShell` agent:** `NAV` must NOT shrink to 7 entries.
`tests/unit/shellGroups.test.ts` is a regression guard that pins two invariants:
`every Page union member appears in NAV` (reachability — it exists because `scripts` was
once rendered but unreachable) and `every NAV key has a page === '...' render branch`.
Shrinking `NAV` breaks both and would delete a guard that caught a real bug.

The change is therefore PARENT-CHILD, not deletion:
- `NAV` keeps all 15 entries exactly as today.
- `NavItem` gains `parent?: Page` (absent = top-level) and `tabs?: Page[]` (children).
- Exactly 7 entries carry no `parent`.
- The sidebar renders only parentless entries; the tab strip renders the children of the
  active top-level item.

The guard's third assertion pins the group set to exactly
`['LIBRARY','SYSTEM','WORKSPACE']`; those labels should be kept if the 7 items map onto
them cleanly, otherwise that one assertion is updated and the change stated in the report.

## Backward-compatibility contract for out-of-scope pages

**Correction found by the G2 omission check:** `.page-header` and `.page-header-actions`
are used by **12 page files**, including pages explicitly outside the redesign scope:

```
Calendar.tsx:104  CloudSync.tsx:335  Placeholder.tsx:11  (page-header)
Catalog.tsx:96  Devices.tsx:69  Diagnostics.tsx:144  Extensions.tsx:106
Groups.tsx:109  Profiles.tsx:1226  Proxies.tsx:160  Settings.tsx:363  Trash.tsx:57
```

The earlier instruction to "delete the dead `.page-header` rules" was wrong: the rules are
not dead, only the shell's own copy is unused. Deleting them would collapse twelve headers.
Therefore: the shell stops using them, but the class must keep a working definition until
every consumer is migrated, OR all twelve consumers are migrated in the same change. The
implementation must pick one and say which — leaving twelve pages broken is not an option
(R02, R04, R05).

## Acceptance interface (how Wave 4 verifies, blind to the spec)

The oracle receives the manifest verbatim plus the repo, and must be able to check:
- row height is 52px and each row is ONE line (measured in a browser),
- 7 top-level nav items and every legacy destination reachable,
- chromatic colour count is still 0 (it is 0 today — a regression here is a failure),
- the icon in `resources/icon.png` is the visor-mask mark, not a shield,
- no `!important` and no literal hex in renderer chrome.
