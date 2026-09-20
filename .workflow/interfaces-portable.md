# Interfaces — portable-state-and-ui-cleanup

Orchestrator-owned. Frozen before the build. One owner per file; zones disjoint.

## Contract: settings and data resolve beside the executable

`src/main/config.ts` — owner: slice A.

```ts
/** Directory the portable executable was launched from. Unchanged. */
export function portableBaseDir(): string | null;

/**
 * Where the settings file lives.
 *
 * Portable launch (PORTABLE_EXECUTABLE_DIR set): `<that dir>/settings.json`, so the recorded
 * choice travels with the folder. Otherwise `ANTIDETECT_SETTINGS_DIR` (the shell passes it), and
 * finally `~/.antidetect` as today.
 */
function settingsBase(): string;

/** Unchanged signature; resolution order gains one rule. */
export function resolveDataDir(): string;
```

**The new rule**, and the reason for it: today a recorded `dataDir` wins unconditionally. On a USB
stick that means the OLD machine's absolute path, which does not exist on the new one. The order
becomes:

1. `ANTIDETECT_DATA_DIR` from outside (tests, CI, a managed deployment) — unchanged.
2. A recorded `dataDir` **that still exists on this machine and holds data** — unchanged for
   existing installations.
3. Portable: `<PORTABLE_EXECUTABLE_DIR>/data`.
4. `<settingsBase>/data`.

The "holds data" test is what makes a moved stick work rather than silently starting an empty
library: a recorded path that is absent, or present but without a database or a non-empty
`profiles/`, is treated as belonging to another machine.

## Contract: the webview cache follows the folder

`src-tauri/src/main.rs` — owner: slice D.

`WebviewWindowBuilder::data_directory(PathBuf)` takes an absolute path, so the shell passes
`<portable dir>/webview` when running portably and leaves the default otherwise. This is what
removes `%LOCALAPPDATA%\NullTrace` as a stray directory.

## Contract: MCP autostart

`src/main/index.ts` — owner: slice C.

```ts
/** Start the MCP server during service start. Returns the reason on failure; never throws. */
export async function startMcpWithService(): Promise<{ started: boolean; error?: string }>;
```

Called once, after the API server is listening, from `startService`. A failure is logged with its
reason and leaves the server stopped — the panel's manual control still works.

## Contract: breadcrumb group

`src/renderer/src/App.tsx` — owner: slice B.

The first breadcrumb segment is the **nav group** of the active destination, not the literal
`Workspace`:

```ts
/** The sidebar group label a page belongs to: 'WORKSPACE' | 'LIBRARY' | 'SYSTEM'. */
function groupOf(page: Page): string;
```

Rendered title-cased (`Workspace`, `Library`, `System`).

## File ownership

| Slice | Owner | Files |
|---|---|---|
| A | fixer-portable | `src/main/config.ts`, `src/main/mcpService.ts` (audit path), `mcp/src/audit.ts`, `tests/unit/dataRoot*.test.ts`, `tests/unit/portable*.test.ts` |
| B | fixer-ui | `src/renderer/src/App.tsx`, `src/renderer/src/pages/Profiles.tsx`, `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/components/AutomationPanel.tsx`, `src/renderer/src/styles.css`, `src/renderer/src/i18n.tsx` |
| C | fixer-mcp | `src/main/index.ts`, `src/main/api/routes/mcp.ts` |
| D | fixer-shell | `src-tauri/src/main.rs` |

**Conflict rule:** B and C both end up in a renderer/backend pair for MCP; C owns the backend and
the autostart, B owns every pixel. Nobody else touches `App.tsx`.

## Non-goals

- Relocating an existing installation's data. Slice A only decides what happens when the recorded
  path is unusable.
- Any change to the update check's behaviour; slice B changes how it looks.
- New runtime dependencies.
