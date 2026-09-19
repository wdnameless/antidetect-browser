# Interfaces — shardx-ui-parity-and-shell

Contract between the two writers. **One owner per file**; a consumer never edits another
owner's file, it calls the interface.

## Ownership

| Owner | Files |
|---|---|
| `@designer` (shell lane) | `src/renderer/src/styles.css`, `src/renderer/src/App.tsx`, `src/renderer/src/pages/Profiles.tsx`, `src/renderer/src/i18n.tsx`, `tests/unit/noirTokens.test.ts`, `src/renderer/vite.config.ts` |
| `@fixer` (data lane) | `src/renderer/src/pages/Settings.tsx` |

The lanes touch disjoint files. `Settings.tsx` is listed in neither the shell's CSS edits nor the
shell's component edits: it consumes tokens that already exist and needs no change from R05–R08.

## D1 — Version resolution (owner: designer)

The footer must never render a bare product name.

```ts
// App.tsx
declare const __APP_VERSION__: string;   // injected by vite define; see D2

// Resolution order, first non-empty wins:
//   1. GET /status → data.version, when it is not 'unknown'
//   2. __APP_VERSION__ (the compiled build's own version)
const [appVersion, setAppVersion] = useState<string>(__APP_VERSION__);
```

`src/renderer/vite.config.ts` gains the define, reading `package.json` at build time. This is
why both files belong to the same owner: the type declaration and the substitution must agree.

```ts
// vite.config.ts
define: { __APP_VERSION__: JSON.stringify(pkg.version) }
```

A missing `package.json` at build time MUST fail the build rather than inject `"unknown"` —
the whole point is that the number is real.

## D2 — Transfer-all (owner: fixer)

Reuses the existing endpoint. **No new backend route.**

```ts
// src/renderer/src/api.ts — already exists, unchanged
dataTransfer(from: string): Promise<ApiEnvelope<{
  ok: boolean; from: string; created: number; skipped: number; dependencies: number; error?: string;
}>>
```

Behaviour in `Settings.tsx`:

```ts
/**
 * Walk every discovered folder and transfer its profiles into the folder in use.
 * Sequential, not parallel: /data/transfer opens the source with sql.js and writes the
 * destination, and several concurrent writers to one SQLite file is how a database gets
 * corrupted. One folder's failure is recorded and the rest continue.
 */
onTransferAll(): Promise<void>
```

Aggregate result shape used for the single status line:

```ts
{ folders: number; created: number; skipped: number; failures: Array<{ dir: string; error: string }> }
```

Status line: `Transferred N profiles, M already present (K folders)` — plus a failure suffix
naming the folders that failed. Rendered through the existing `setDataDirMsg` channel.

Visibility rule (R03): the control renders only when `scanResults.some((f) => f.profiles > 0)`.
Disabled while `transferringDir !== null` or `transferAllBusy`, so the per-row and aggregate
controls cannot run together.

## D3 — Token contract (owner: designer)

New tokens are declared in `:root` and the light theme, and consumed by class names. Status
tokens gain hue; identity tokens must not.

| Token | Dark | Light | Chroma allowed |
|---|---|---|---|
| `--ok` | `#22c55e` | `#15803d` | yes |
| `--warn` | `#f59e0b` | `#b45309` | yes |
| `--danger` | `#ef4444` | `#b91c1c` | yes |
| `--ok-bg` / `--warn-bg` / `--danger-bg` | hue at 0.14 alpha | hue at 0.12 alpha | yes |
| `--accent`, `--accent-*` | unchanged | unchanged | **no** |
| `--surface-*`, `--bg-*`, `--panel*`, `--border`, `--divider` | unchanged | unchanged | **no** |
| `--text*` | unchanged | unchanged | **no** |

`tests/unit/noirTokens.test.ts` narrows its guard to that third group: the status tokens move to
an explicit `HUE_ALLOWED` set, everything else keeps the existing `CHROMA_TOLERANCE = 12` rule.
The accent and surfaces are asserted by name, so this cannot become a blanket exemption.

Reference geometry to adopt (measured from the reference, not invented):

| Property | Value |
|---|---|
| Sidebar width | 240px, 280px at ≥1700px |
| Content padding | 28px horizontal, 24px vertical |
| Metric card | radius 8px, padding 16px/14px, label 11px uppercase, value 20px/28px tabular |
| Card radius (panel) | 14px |
| Nav item | padding 10px/6px, radius 8px, icon 18px, gap 10px |
| Section label | 11px uppercase, letter-spacing 0.22px |
| Breadcrumb / labels | 12px/16px, weight 500 |
| Search input | 320px wide, 32px tall |

Type scale stays ours (`--text-*`); the reference's 14px base is already what `--text-md` is.
