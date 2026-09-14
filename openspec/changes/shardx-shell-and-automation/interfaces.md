# Interfaces — shardx-shell-and-automation

Written by the orchestrator BEFORE any spawn. Read by path; one writer per file.

## Zone ownership (disjoint by construction)

| Zone | Owner | Files (exclusive) |
|---|---|---|
| A. Typography | `FontsTypography` | `src/renderer/src/styles.css`, `src/renderer/assets/fonts/**`, `src/renderer/index.html` |
| B. MCP wiring | `McpWiring` | `mcp/**`, root `package.json` (scripts only), `src/main/mcp*.ts`, `src/main/api/routes/mcp.ts`, `src/main/api/server.ts` (route mount only) |
| C. Footer panels | `FooterPanels` | `src/renderer/src/App.tsx`, `src/renderer/src/components/McpPanel.tsx`, `src/renderer/src/components/ServicePanel.tsx`, `src/renderer/src/api.ts` |
| D. Automation | `AutomationResponsive` | `src/renderer/src/pages/FlowCanvas.tsx`, `src/renderer/src/components/InspectorDrawer.tsx` |

Zone C consumes classes A defines and an endpoint B exposes. Both contracts are frozen below.

## Dependency order (real, not ceremonial)

`FooterPanels` (C) needs the MCP status endpoint that `B` creates. C is therefore spawned in a
SECOND batch, after B reports its route path. A and D have no dependency and run in batch 1.

## Contract 1 — typography (A defines, C and D consume)

Self-hosted, no network at runtime. Rationale: this is a privacy tool; a CDN font is an
outbound request on every launch.

```
assets/fonts/Inter-latin.woff2      (48256 bytes, variable)
assets/fonts/Inter-cyrillic.woff2   (18748 bytes, variable)
```

**Verified, not assumed:** Google serves a **variable** Inter — the four weight URLs are
byte-identical (`md5` identical across 400/500/600/700), so downloading one file per weight
yields four copies of the same font. Only two files are needed, one per subset, and each
declares `font-weight: 100 900` so a single face covers every weight. `latin` and `cyrillic`
are the only subsets this UI uses, and cyrillic is REQUIRED — the interface ships Russian
strings.

`@font-face` uses `font-display: swap` and a RELATIVE `url()` so the packaged `app.asar`
resolves it; `index.html` must NOT gain any external `<link>`.

New token A publishes (C and D consume; nobody invents sizes):

```
--text-2xs: 10px      /* uppercase micro-labels only */
--text-xs: 11px
--text-sm: 12px
--text-base: 13px
--text-md: 14px
--text-lg: 15px
--text-xl: 18px
--text-2xl: 22px      /* page titles */
--tracking-wide: 0.06em   /* ALL CAPS section labels, never 0 */
--tracking-tight: -0.011em /* body/headings, Inter reads loose at default */
--weight-normal: 400
--weight-medium: 500
--weight-semibold: 600
--weight-bold: 700
```

Rules: ALL-CAPS labels MUST carry letter-spacing (anti-slop rule); `--font-sans` keeps the
name `Inter` but now resolves to the real face; the system-ui fallback chain stays intact so
a font failure degrades rather than breaks. Numeric table cells use `font-variant-numeric:
tabular-nums`.

## Contract 2 — MCP status endpoint (B exposes, C consumes)

`GET /api/v1/mcp/status` — Bearer-authenticated like every other `/api/v1` route.

```json
{ "code": 0, "msg": "success", "data": {
  "running": false,
  "transport": "stdio",
  "httpPort": 40325,
  "httpUrl": "http://127.0.0.1:40325/mcp",
  "toolCount": 40,
  "tier1Count": 34,
  "tier2Count": 12,
  "startedAt": null
} }
```

`running` MUST reflect the actual child process, never the requested intent (R10i). `POST
/api/v1/mcp/start` and `POST /api/v1/mcp/stop` toggle it and return the same shape.

`toolCount`/`tier1Count`/`tier2Count` are counted from the real registry in `mcp/src/tools.ts`,
not hardcoded — a hardcoded count is a claim that rots.

## Contract 3 — service panel data (C consumes, already exists)

The Automation API endpoint is the running loopback API. The renderer already holds the key
(`src/renderer/src/api.ts`); the panel reports the real origin and offers copy. Do not invent
a second port.

## Contract 4 — responsive Automation (D implements, A supplies tokens)

Breakpoints, defined once in `styles.css` by A and consumed by D:

```
--bp-narrow: 1100px   /* below: inspector becomes a drawer, palette collapses */
--bp-mid:    1400px   /* below: palette narrows */
```

Behaviour:
- **≥1400px** — palette | canvas | inspector, all three visible.
- **1100–1400px** — palette narrows to icon rail; inspector stays.
- **<1100px** — palette is an icon rail; **inspector becomes an overlay drawer** opened from a
  button, closed by `Esc` and by clicking the scrim; the canvas takes the remaining width.

`FlowCanvas.tsx` currently hardcodes `width: 260` and `width: 180`. Those MUST become
token/breakpoint-driven. No horizontal page scrollbar at any width ≥900px.

The drawer must be keyboard-reachable: focus moves into it on open, `Esc` closes it, focus
returns to the trigger. A drawer that traps nothing but is unreachable by keyboard is a bug.

## Preservation contract (all zones)

- Zero literal hex in renderer chrome — `tests/unit/noirTokens.test.ts` scans every renderer
  source file and MUST stay green.
- The 7 destinations and their sub-tabs stay reachable — `tests/unit/shellGroups.test.ts`
  MUST stay green.
- Rows stay 52px single-line — `.row-dense` is not touched.
- No `!important`.
- `npm run build` and the typecheck must pass; `mcp/` must build via `tsc` with no new runtime
  dependency beyond what `mcp/package.json` already declares.
