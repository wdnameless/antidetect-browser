# Recon — UI parity with ShardBrowser + shell fixes (0.6.7)

Lane T2. Wave 0 interview held (4 forks answered). Change `shardx-ui-parity-and-shell`.

## What reconnaissance changed about the work

Two of the three "missing" shell features already existed, which reframed the task from
"build" to "surface and fix":

- **Collapse exists**: `Ctrl/Cmd+B`, a 52px rail, persisted through `sidebarLogic.ts`. The
  reference product has NO collapse (`grid-template-columns:240px_1fr`, fixed), so this is
  ours to preserve, not to port.
- **The version line exists** but renders a bare product name whenever `GET /status` answers
  `unknown` — which is exactly what the operator's build does, because the backend resolves
  `ANTIDETECT_APP_VERSION` from the shell env and nothing re-exports it. Verified by running
  the resolver directly: with the env set it returns the value, without it returns `unknown`.
- **Transfer exists per row**; the aggregate control was genuinely absent.

## Reference measurements (read from `D:/tmp/shardref`, not invented)

| Property | Value |
|---|---|
| Sidebar width | 240px (280px at ≥1700px) |
| Content padding | 28px horizontal, 24px vertical |
| Radius scale | 8px small, 14px panel, 20px card |
| Metric card | label 11px uppercase, value 20px/28px, tabular |
| Nav item | icon 18px, gap 10px, radius 8px |
| Section label | 11px uppercase, 0.22px tracking |
| Accent (NOT adopted) | `#535efd` — the operator asked for our colours |

## The conflict the interview resolved

The reference is built on a blue accent plus coloured statuses. This app's palette is
monochrome and TWO separate tests enforce that (`noirTokens.test.ts` and
`themeAndMcpScope.test.ts` — the second was not noticed by the lane agent and caught the
change at the full-suite run). Decision from Wave 0: statuses gain hue, identity does not.
Both guards were narrowed by NAME to the six status tokens; a blue `--accent` was then
injected deliberately and three tests failed, proving the narrowed guards still bite.

## Files touched

- `src/renderer/vite.config.ts` — injects `__APP_VERSION__` from `package.json`, fails the build if absent
- `src/renderer/src/global.d.ts` — declares the global
- `src/renderer/src/App.tsx` — version seeded from the build; breadcrumb moved into content; titlebar keeps drag + controls
- `src/renderer/src/pages/Profiles.tsx` — four metric cards from real endpoints, `loaded` flags so an unloaded value is `—` not `0`
- `src/renderer/src/styles.css` — reference geometry, metric card, breadcrumb, status hues in both themes
- `src/renderer/src/pages/Settings.tsx` — `onTransferAll()` sequential walk + aggregate control
- `src/renderer/src/i18n.tsx` — new strings, RU + EN
- `tests/unit/noirTokens.test.ts`, `tests/unit/themeAndMcpScope.test.ts` — narrowed hue guards

## Acceptance check (all executed)

| Requirement | Evidence |
|---|---|
| R01 collapse | 240 ↔ 52px by clicking; toggle visible in BOTH states; 0 elements bleed past the rail; 7 destinations reachable |
| R02 version | Footer reads `NullTrace v0.6.7` with the backend answering `unknown`; `0.6.7` found in the built bundle |
| R03 transfer-all | On an empty destination: `Transferred 3 profiles, 0 already present (1 folders)` and `/browser/list` went 0 → 3 with names. Re-run on a populated folder: `0 profiles, 3 already present`. Per-row buttons still present (2) |
| R04 parity | Breadcrumb `Workspace / Profiles` inside the content, `.topbar .page-title` gone; sidebar measured 240px; metric radius 8px; four cards read real values (Devices 5) |
| R06 statuses | `--ok #22c55e`, `--warn #f59e0b`, `--danger #ef4444` (dark) with light-theme pairs; guards narrowed by name and proven to still fail on a blue `--accent` |
| No regressions | `npm test` 131 files / 1088 passed; both typechecks exit 0 |
