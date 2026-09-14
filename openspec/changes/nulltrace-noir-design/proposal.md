## Why

The interface still reads as a boxed grey-blue admin panel: cards, tables, chips and
icon buttons each draw a full-perimeter border, the window carries a native light
title bar and a `File/Edit/View/Window` menu, and navigation is one flat list of 14
items. The user wants ShardX's structure in monochrome: grouped navigation, flat
surfaces, minimal borders, and a sidebar footer that exposes the automation API.

Reconnaissance found the redesign is cheaper than it looks. The token layer already
exists — `src/renderer/src/styles.css:1-29` defines ~30 custom properties and they
are **already greyscale** except for four legacy semantic values. The whole visual
change therefore flows from one file plus a mechanical sweep, not from restyling 18
pages by hand.

Two facts shape the work:
- **The borders are enumerable.** 12 rules draw hairline separators that carry real
  structure (table rows, section breaks, modal head/foot, sidebar footer edge) and
  must survive. The rest are box borders on containers, controls and chips.
- **The shell is small.** Sidebar, brand, nav, footer, topbar and a page switch —
  all in `App.tsx:164-293`, with `NAV` at `:53-68` and the `Page` union at `:45`.

Two inconsistencies were also found and are fixed as part of this: `scripts` is a
valid page but is missing from `NAV` (so it is unreachable by clicking), and two
pages render their own `h2` title while the shell already renders one.

## What Changes

**Tokens.** Neutralise the remaining hue, extend the layer with the values the new
components need (surface steps, divider, control backgrounds, radius scale), and
make every chrome value resolve through it. The second, orphaned token dialect —
inline `var(--x, #hex)` fallbacks referencing variables that do not exist in
`:root` — is removed, because those silently collapse during a restyle.

**Shell.** Grouped navigation (WORKSPACE / LIBRARY / SYSTEM) with small uppercase
section labels; collapse still works. A shared page-header primitive carrying
breadcrumb, title, one-line description and right-aligned actions, replacing both
the topbar `h1` and the per-page duplicate `h2`s. `scripts` is restored to the
navigation.

**Frameless window.** The native title bar and the application menu are removed; the
app supplies a draggable header region and its own minimise/maximise/close controls.
Tray and close-to-tray behaviour are preserved.

**Frames removed.** Box borders and elevation come off containers, controls, chips,
pills and icon buttons. Hairline dividers stay. Surfaces separate by a subtle
background step.

**Sidebar footer.** ShardX-shaped: an AUTOMATION API panel with a live status dot, a
monospace address and a copy affordance, then the MCP download and documentation
actions, then the theme toggle, then the version line.

## Capabilities

### New Capabilities
- `noir-design-system`: neutral token layer, flat surfaces, grouped shell, header primitive, frameless chrome.

### Modified Capabilities

None.

## Impact

- `src/renderer/src/styles.css` (the token layer, the box-border rules, the new
  component classes), `src/renderer/src/App.tsx` (shell + groups + footer),
  `electron/main.ts` (frameless window, menu removal), new primitives under
  `src/renderer/src/components/`, then a sweep of the 18 pages.
- Tests: token completeness and hue-freedom, nav-group completeness (every page
  reachable, nothing lost), and the frameless window configuration.

### Goals

- One place decides the look: the token layer.
- No hue in chrome, and no box borders on chrome.
- Every page reachable from the navigation; no duplicated page titles.
- The window looks like the app, not like Windows.

### Non-Goals

- No page re-architecture (R68i). The Profiles page keeps its table + modal
  structure; the sectioned ShardX form layout is explicitly **not** built (R69i).
- No light theme. The product is dark-only; the theme toggle reflects that rather
  than pretending to offer a second theme.
- No new dependency, no CSS framework, no Tailwind.
- Operator-chosen data colours (profile/tag colour pickers) are NOT chrome and are
  left alone.

### Risks and commitments

- **Frameless is the riskiest part.** Removing the native title bar means the app
  must provide dragging and window controls, and a mistake can leave the window
  unmovable or unclosable. Tray restore and the existing close-to-tray logic must be
  verified after the change, not assumed.
- **~200 inline colour literals across pages** are the sweep's blast radius. Tokens
  fix class-based surfaces immediately; the sweep is ordered worst-first and each
  page is verified as it lands.
- **Semantic states lose colour.** "Healthy" and "failed" must stay distinguishable
  by weight, shape and icon rather than hue, or the change makes the UI worse.
- **A browser-served client has no window controls.** The custom controls are
  Electron-only; in a browser the header must not render buttons that do nothing.
