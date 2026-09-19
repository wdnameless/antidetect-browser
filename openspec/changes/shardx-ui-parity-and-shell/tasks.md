# Tasks — shardx-ui-parity-and-shell

## 1. Shell lane (@designer) — owns styles.css, App.tsx, Profiles.tsx, i18n.tsx, vite.config.ts, noirTokens.test.ts

- [ ] 1.1 `vite.config.ts`: inject `__APP_VERSION__` from `package.json`; fail the build when it is
      missing. Declare the global for the renderer's typecheck.
- [ ] 1.2 `App.tsx` (R02): initialise the footer version from `__APP_VERSION__`, upgrade it when
      `GET /status` answers a real value. The footer must never render a bare product name.
- [ ] 1.3 `styles.css` (R06): status tokens gain hue (`--ok`, `--warn`, `--danger` and their
      `-bg` pair) in both themes. Accent, surfaces, borders and text stay monochrome.
- [ ] 1.4 `noirTokens.test.ts`: move the three status tokens (+ backgrounds) into an explicit
      hue-allowed set; assert by name that `--accent`, `--surface-*`, `--bg-*`, `--border`,
      `--divider`, `--text*` still pass the chroma rule. No blanket exemption.
- [ ] 1.5 `styles.css` (R05/R08): shell geometry from the reference — sidebar 240px (280px at
      ≥1700px), content padding 28px/24px, radii 20px card / 14px panel / 8px small, nav item
      padding and icon size, uppercase section label with 0.22px tracking.
- [ ] 1.6 `styles.css` (R08): card surface treatment for content blocks; breadcrumb row; metric
      card; tabs with counts; toolbar row; table header treatment; empty state.
- [ ] 1.7 `App.tsx` (R07): move the page name into the content area as a `Workspace / <Page>`
      breadcrumb with page search beside it; titlebar keeps drag + window controls only.
- [ ] 1.8 `App.tsx` (R01): keep the collapse, make its control discoverable in both states.
- [ ] 1.9 `Profiles.tsx` (R08): render the four metric cards (Profiles/Running/Proxies/
      Fingerprints) from backend values, with a loading state that is not `0`; folder tabs with
      counts; designed empty state with a call to action.
- [ ] 1.10 `i18n.tsx`: strings for the new labels, RU + EN.

## 2. Data lane (@fixer) — owns Settings.tsx only

- [ ] 2.1 (R03) `Settings.tsx`: `onTransferAll()` walking `scanResults` sequentially, aggregating
      `{folders, created, skipped, failures}`, reporting one status line, continuing past a
      folder that fails.
- [ ] 2.2 (R03) Render the aggregate control above the results list, only when at least one
      folder has profiles; disabled while any transfer runs. Per-row controls stay.
- [ ] 2.3 (R03) i18n keys used by 2.1/2.2 must exist — coordinate the exact key strings with the
      designer lane through `hub` before using them.

## 3. Integration (orchestrator)

- [ ] 3.1 Append lane interfaces to `interfaces.md`; update manifest rows to `done`.
- [ ] 3.2 Both typechecks + full suite on the merged tree.
- [ ] 3.3 Runtime verification against a real backend: sidebar collapse in both states, version
      in the footer, transfer-all actually moving profiles, Profiles page rendering.
- [ ] 3.4 Oracle blind acceptance vs the manifest (not vs this spec).
- [ ] 3.5 Version bump, changelog, tag, release, verify the published payload.
- [ ] 3.6 `archmap.mjs scan` and read the delta back.
