## Why

ShardX's MCP server exposes "30+ API tools, 60+ CDP/patchright tools". Ours has 17: 12 default (`profiles.list/get/create/start/stop`, `browser.navigate/click/type/human_type/human_click/screenshot`, `diagnostics.run`) and 5 gated (`profiles.delete/restore/export_preserved/cleanup_preserved`, `browser.evaluate_allowlisted`).

Reconnaissance found large areas of the Local API with no MCP tool at all: proxies, proxy health, extensions, flows, task groups, trash (only restore is covered), cookies, email, vault, triggers, scripts, tags, devices, catalog, cloud, teams, kernel, licensing, settings, sync, logs, preflight, batch, motion, cookie robot. An agent driving this product can manage profiles and a browser, and nothing else.

The registry is a single registration point: a `ToolManifest` entry in `TOOL_DEFINITIONS` (`mcp/src/tools.ts:28`), a `case` in the `executeToolInternal` switch (`:427`), and membership in `DEFAULT_TOOL_NAMES` or `GATED_TOOL_NAMES` (`mcp/src/auth.ts:13`). The gating model, the audit log and the prohibited-tool list must all stay intact.

## What Changes

- Add tools for the uncovered API areas that an operator is likely to drive: proxies, extensions, flows, task groups, trash, cookies, triggers, tags, and batch operations.
- Classify each by risk with the existing tiers: read and routine operations default; destructive or credential-touching operations gated behind the existing `admin` / `profile:write_danger` scopes.
- Keep every existing guarantee: the prohibited-tool list, the nonce/TTL replay defence, the hash-chained audit log, and the allowlist for scripted evaluation.
- No raw CDP execution, no arbitrary filesystem access, no unbounded `Runtime.evaluate` — the prohibited set stays prohibited.

## Capabilities

### New Capabilities

None — this extends an existing capability.

### Modified Capabilities
- `mcp-server`: a materially larger, risk-classified tool surface.

## Impact

- `mcp/src/tools.ts`, `mcp/src/auth.ts`, `mcp/README.md` (the tool list is documented there), `tests/` coverage for the new tier classification.
- **`mcp/src/tools.ts` is also edited by `add-form-filling-helper`.** Serialize on that file.
