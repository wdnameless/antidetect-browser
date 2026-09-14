# Tasks — ui-density-redesign

Traced to `manifest.md` (R01–R14i) and contracted by `interfaces.md`.
Every task names the requirements it serves; every requirement is served by ≥1 task (G3).

## 1. Zone A — tokens and shell (`TokensShell`)

- [ ] 1.1 Publish the missing scales in `styles.css`: `--space-1…7`, `--row-h: 52px`,
      `--control-h`, `--control-h-sm`, `--sidebar-w: 232px`, `--sidebar-w-collapsed`,
      `--topbar-h`, and the role-named type scale. Keep every existing token name and
      meaning; additions only. → R03, R06
- [ ] 1.2 Remove the SHELL's dead chrome: the shell's own unused `.page-header` block,
      the duplicated `.window-controls` block, the duplicated `.page-header-actions`
      block, and both `!important` flags. **CORRECTED after the G2 omission check:**
      `.page-header`/`.page-header-actions` are NOT dead — 12 page files consume them
      (`Calendar.tsx:104`, `Settings.tsx:363`, `Proxies.tsx:160`, … listed in
      `interfaces.md`). Only the shell's copy is unused. Either keep a working definition
      for the consumers or migrate all 12 in this change; do not leave them collapsed.
      Then rebuild `.topbar` and the shell on the new metrics. → R04, R05, R06
- [ ] 1.2b Add the missing `:focus-visible` ring (the stylesheet has **zero** such rules
      today) and ensure the hidden-row-actions pattern does not add invisible tab stops:
      a row's actions become tabbable only while that row is focused. → R05, R14i
- [ ] 1.3 Convert boxed containers to surfaces: drop full-perimeter borders, keep
      dividers where they carry structure (rows, sections, modal head/foot, sidebar edge). → R04
- [ ] 1.4 Regroup navigation in `App.tsx` to the seven destinations frozen in
      `interfaces.md`, rendering sub-tabs from the existing `Page` union (no router).
      Keep the Profiles running badge and the Cloud sync dot. → R01, R02
- [ ] 1.5 Implement the frozen `.row-dense` class contract exactly as written in
      `interfaces.md`, including hover/focus-revealed actions that stay keyboard-reachable. → R03

## 2. Zone B — brand icon (`BrandIcon`)

- [ ] 2.1 Author the visor-mask mark as ONE SVG source of truth (replacing the indigo
      shield geometry and removing `#6366f1`). → R10
- [ ] 2.2 Rewrite `scripts/generate-app-icon.mjs` to rasterise that mark, emitting a
      distinct simplified 16px variant so the eye slits survive tray/favicon size. → R11, R12i
- [ ] 2.3 Regenerate every consumer from the script: `resources/icon.png`,
      `resources/tray-icon.png`, `assets/brand/*.png`, `.ico`, `.icns`, favicon. → R11
- [ ] 2.4 Redraw the sidebar brand mark in `icons.tsx` from the same source. → R11

## 3. Zone C — dense tables (`DenseTables`)

- [ ] 3.1 `Profiles.tsx` — restructure the row to the `.row-dense` contract: one line,
      secondary metadata collapsed to `--text-muted`, actions revealed on hover/focus.
      Preserve search, filters, pagination, batch actions, row actions and operator
      colour choices. → R03, R09, R13i, R14i
- [ ] 3.2 `Proxies.tsx`, `Devices.tsx`, `Extensions.tsx` — adopt the same row contract. → R03, R09, R14i
- [ ] 3.3 `Groups.tsx`, `Trash.tsx` — adopt the same row contract; these are now
      sub-tabs of Profiles. → R01, R03, R09
- [ ] 3.4 Remove any remaining page-local chrome that duplicates the shell (repeated
      title headers, bespoke toolbars), using `EmptyState` where a page has none. → R04, R05

## 3.5 Visual bug inventory (from the G2 omission check)

The user said verbatim «много визуальных багов», and the spec asserted bugs would be fixed
without enumerating a single one. That is unfalsifiable. Concrete, verified defects found
by measurement, each with a checkable acceptance:

- [ ] 3.5a `:focus-visible` count in `styles.css` is **0** — every keyboard user gets the
      browser default or nothing. Acceptance: count > 0 and a focused control is visibly
      ringed in a screenshot. → R05
- [ ] 3.5b Rows measure exactly **100px** and stack two storeys; the reference is ~50px.
      Acceptance: measured row height is `var(--row-h)` and the row is one line. → R03, R05
- [ ] 3.5c **55 elements** draw a full-perimeter border, so every control reads as a box.
      Acceptance: the count drops materially and containers separate by surface/divider. → R04
- [ ] 3.5d Two `!important` rules exist (`styles.css` ~:132, ~:978). Acceptance: zero. → R04
- [ ] 3.5e Two parallel header systems coexist — live `.topbar` (48px) and an unrendered
      `.page-header` (64px), plus duplicated `.window-controls` and `.page-header-actions`
      blocks. Acceptance: one header system in the shell; no duplicated selector blocks. → R04, R05
- [ ] 3.5f No spacing scale exists — every gap is a literal px. Acceptance: spacing
      resolves through `--space-*`. → R06

## 4. Verification

- [ ] 4.1 Full suite green and typecheck clean; the noir token guard stays green. → R07, R08
- [ ] 4.2 **Look at it in a browser.** Measure and confirm: row height is 52px and each
      row is one line; 7 top-level items; all 15 legacy destinations reachable; chromatic
      colour count is still 0; no `!important`. Screenshot Profiles, Proxies and a
      sub-tab page. → R01–R09
- [ ] 4.3 Confirm the icon is the visor mask in the packaged `.exe`, and legible at 16px
      **and against both a dark and a light OS surface** — the mark is solid black, and a
      black glyph on a dark Windows taskbar is invisible. → R10, R11, R12i
- [ ] 4.4 CHANGELOG entry.

## 5. Out of scope (recorded, not scheduled)

- [ ] 5.1 Light theme — the user chose «Оставить тёмную».
- [ ] 5.2 FlowCanvas internal re-architecture — inherits tokens only.
