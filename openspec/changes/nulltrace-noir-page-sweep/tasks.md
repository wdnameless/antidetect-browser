# Tasks — nulltrace-noir-page-sweep

Order: guards first (so the sweep is verifiable), then the dominant file, then the rest,
then the two reported defects.
Suite stays green (119 files / 944 tests) and typecheck clean throughout.

## 1. Extend the guards to page sources (do first)

- [x] 1.1 Extend `tests/unit/noirTokens.test.ts` from `styles.css` only to **every
      renderer source file** (`.tsx`/`.ts` under `src/renderer/src`), so the sweep is
      enforced rather than merely performed. The perceptual greyscale rule already in
      that file applies unchanged.
- [x] 1.2 The same guard must fail on an orphan reference: no `var(--x, #hex)` anywhere
      in renderer sources. Email.tsx currently has 20 of these and must reach zero.
- [x] 1.3 The guard must NOT flag operator data colours. Those live in the colour
      pickers; exclude them by the mechanism that actually distinguishes them (a
      dedicated palette module), not by a filename allowlist that will rot.

## 2. Flow Canvas (192 literals — the bulk of the work)

- [x] 2.1 Neutral greys → token references. `#a1a1aa` → `--text-secondary`,
      `#71717a` → `--text-muted`, `#fafafa` → `--text`, `#141416` → `--surface-*`,
      `#18181b` → `--panel-hover`, `#e4e4e7`/`#d4d4d4` → the appropriate text/surface
      step. This is the majority of the 192 and is a substitution, not a redesign.
- [x] 2.2 **Validation state** (`#22c55e` / `#ef4444` at ~1196-1197) — this drives a
      real boolean, so the *branch* must stay and only the *appearance* changes.
      Replace green/red with a monochrome distinction: background step plus a
      shape/weight difference, so valid and invalid remain tellable apart.
- [x] 2.3 **Live-run indicator** (`#3b82f6` at ~1484, `#22c55e`) — same rule: this is
      `isRunning ? … : …`, keep the branch, express the two states without hue.
- [x] 2.4 **SVG edge markers** (`stroke="#3b82f6"`, `#ef4444`, `#ffffff`,
      `marker` fills at ~1285-1307, 1349, 1395) — SVG presentation attributes do not
      inherit CSS variables. Apply the value through `style` or resolve it from the
      token in JS. This needs a per-site decision; do not blind-replace.
- [x] 2.5 Node/edge/palette colours that encode the node TYPE (a colour per node kind)
      must become a monochrome scheme — weight, border style, or a small glyph — not
      six shades of grey nobody can tell apart. Verify by looking at the canvas.

## 3. Remaining files

- [x] 3.1 `pages/Email.tsx` — 51 literals AND 20 orphan `var(--x, #hex)`. Worst
      offender after FlowCanvas; the orphan dialect must reach zero.
- [x] 3.2 `components/FleetPanel.tsx` — 18 literals; its `STATUS_COLORS` map already
      moved to tokens, so verify these are the remaining inline ones.
- [x] 3.3 `pages/Profiles.tsx` (8), `pages/Calendar.tsx` (8) — **but preserve the
      operator's profile/tag colour choices**; only chrome changes (R76i).
- [x] 3.4 `pages/Diagnostics.tsx` (5 + 1 orphan) — its `statusColor()` function returns
      hard hex and must become token-based.
- [x] 3.5 `pages/SecuritySettings.tsx`, `pages/SyncSettings.tsx`, `pages/Extensions.tsx`
      — small counts, including two orphans.

## 4. The two reported defects

- [x] 4.1 **Duplicate titles**: remove the page-level `h2` in `Proxies.tsx:156-170` and
      `Extensions.tsx:104-114` — the shell now renders the title. One title per page.
- [x] 4.2 **Empty states**: extract one primitive (`components/EmptyState.tsx`) and
      adopt it in `Profiles.tsx:1367-1393`, `Proxies.tsx:317-329`,
      `Extensions.tsx:182-194`, and any other inline variant. It must state what the
      page is for and what to do next, with an optional primary action.

## 5. Verification

- [ ] 5.1 Full suite green, typecheck clean.
- [ ] 5.2 **Look at it.** Screenshot at least Profiles, Flow Canvas and Email in a
      browser. Confirm: no hue, no box borders, dividers intact, groups render,
      validation/live-run states still readable, and operator colours preserved.
- [ ] 5.3 CHANGELOG entry.
- [ ] 5.4 Confirm the deferred item is still deferred: no page re-architecture (R77i).

## 6. Deferred (recorded, not scheduled)

- [ ] 6.1 ShardX-style sectioned Profiles form with counters — offered, not chosen (R69i).
- [ ] 6.2 Light theme — the product is dark-only.
