## Why

The user's verdict on the current interface is «слишком нагромажденный» with «много
визуальных багов», and the reference they want is ShardX: dense single-line rows, a short
grouped sidebar, flat surfaces, and one accent. The ask is minimalism **without** cutting
function — «не урезать функционал».

Measurement changed the plan. Before writing anything, the running app was instrumented:

- The renderer paints **0 chromatic colours across 19 distinct values**. The monochrome
  sweep a previous change started is genuinely finished, so colour is NOT the clutter.
- Profile rows measure exactly **100px** and stack two storeys (name + chips on the first,
  proxy/os/fingerprint on the second). ShardX rows are ~50px and single-line. **Density is
  the clutter.**
- **55 elements** draw a full-perimeter border — every control reads as a box.
- The sidebar carries **15 nav items** and the screen **44 buttons**; the sidebar is 220px.
- A live `.topbar` (48px) renders while `.page-header` (64px) does not — its rules, a
  second `.window-controls` block and two `!important` flags remain as dead weight in a
  1614-line stylesheet with **no spacing scale at all** (every gap is a literal px).

So the work is structural, not decorative: give the stylesheet a real scale, collapse
navigation into seven grouped destinations with contextual sub-tabs, and make rows single-line.

Two prior deferrals are cancelled by this message and superseded deliberately:
`nulltrace-noir-page-sweep` recorded R69i («ShardX-style sectioned Profiles form … offered,
not chosen») and R77i («no page re-architecture»). The user now asks verbatim for the
ShardX interface with dense rows, which accepts that offer and reverses that boundary.

The brand icon is also wrong. The repo generates an indigo shield (`#6366f1` — the single
most recognizable AI-generated-design tell) from `scripts/generate-app-icon.mjs`, and a
second, unrelated monochrome silhouette PNG sits beside it. Neither is the mark the user
supplied: a black visor-mask with eye slits. The icon is regenerated from the user's mark
and applied across `.exe`, tray, favicon, `.icns`/`.ico` and the sidebar.

## What Changes

**A real scale replaces ad-hoc pixels.** The stylesheet gains the spacing scale it never
had (`--space-1…7`, 4px base), density metrics (`--row-h: 52px`, `--control-h`), shell
metrics (`--sidebar-w`, `--topbar-h`) and a role-named type scale. Existing token names and
their meanings are preserved so nothing breaks; the additions are consumed by everything
that follows. Two `!important` flags and the dead header/control duplicates are deleted
rather than preserved.

**Navigation becomes seven grouped destinations with sub-tabs.** Profiles, Proxies,
Browser, Automation, Library, Cloud, Settings. Every one of today's 15 destinations stays
reachable — Groups and Trash become sub-tabs of Profiles, Devices and Extensions of
Browser, Flow Canvas and Scripts of Automation, Email/Calendar/Catalog of Library, Cloud
Sync and Teams of Cloud, Diagnostics/Security/License of Settings. The existing `Page`
union drives the tab strip; no router is introduced. Badge counters survive on Profiles
and Cloud.

**Rows become single-line at 52px.** A frozen class contract (`-row-dense` and its slots)
is defined in `interfaces.md` before implementation so the shell and the pages cannot
diverge. Row actions are hidden until hover or keyboard focus but remain reachable —
`opacity`, never `display:none`. Secondary metadata collapses onto one line at
`--text-muted`, the primary label at `--text`, and a row separates with a single
`border-bottom` on the divider rather than a full box.

**Boxes become surfaces.** 55 full-perimeter bordered containers is the visual signature
of the complaint. Containers lose their box border and separate by surface step and
divider; borders remain only where they carry structure (table rows, section breaks,
modal head/foot, sidebar footer edge).

**The icon becomes the user's mark.** `scripts/generate-app-icon.mjs` is rewritten to draw
the visor-mask from a single SVG source of truth, and every raster consumer is regenerated
from it: `resources/icon.png` (`.exe`), `resources/tray-icon.png`, `assets/brand/*.png`,
`.ico`, `.icns` and the favicon. A simplified variant is used at 16px, because the eye
slits close up at tray size. The sidebar brand mark is redrawn from the same source.

## Impact

- Affected specs: `noir-design-system` (extended, not replaced)
- Affected code: `src/renderer/src/styles.css`, `App.tsx`, the six table pages, `icons.tsx`
  (brand mark only), `scripts/generate-app-icon.mjs`, `assets/brand/*`, `resources/*`
- Preserved: the monochrome palette (0 chromatic colours must stay 0), dark-only theme,
  operator colour pickers, and every existing page capability — search, filters,
  pagination, batch actions, row actions.
- Excluded: light theme (the user chose dark), and FlowCanvas internal re-architecture —
  it inherits the new tokens only.
