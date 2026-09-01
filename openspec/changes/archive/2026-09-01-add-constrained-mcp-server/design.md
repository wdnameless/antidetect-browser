## Context

As AI assistants and agentic frameworks orchestrate multi-step browser workflows, exposing a standardized Model Context Protocol (MCP) server becomes a core product requirement. However, naive MCP implementations often bridge directly to raw DevTools/CDP interfaces or shell executors, exposing the entire host environment to prompt injection and unauthorized credential exfiltration.

Dated public ShardBrowser/ShardX observations (2026-08) note agent integration points with constrained tool sets. This design provides a hardened, constrained MCP server over stdio and loopback HTTP.

## Decisions

### 1. Transport architecture (stdio + loopback HTTP)
Implement standard JSON-RPC 2.0 / MCP transport in `src/main/mcp/server.ts`.
- Default transport: `stdio` for local subagent execution (Cursor, Claude Desktop, Paseo, custom runners).
- Optional transport: `http://127.0.0.1:<port>` with loopback-only binding and mandatory Bearer token authentication.
- Reuses the HTTP server infrastructure, rate limiting, and request sanitization from `src/main/api/server.ts`.

### 2. Strict tool segregation and prohibited actions
The MCP tool registry exposes three strict tiers:

#### Tier 1: Default tools (Standard automation scope)
- `profiles.list`: Enumerate profiles (metadata only, no credentials).
- `profiles.get`: Retrieve profile parameters.
- `profiles.create`: Provision a new profile from template/catalog.
- `profiles.start`: Launch a profile browser session.
- `profiles.stop`: Terminate a running browser session.
- `browser.navigate`: Navigate active page to target URL.
- `browser.click`: Click element by CSS/XPath selector.
- `browser.type`: Type text into input element.
- `browser.screenshot`: Capture visual snapshot (base64 PNG).
- `diagnostics.run`: Execute health and proxy verification probes.

#### Tier 2: Gated tools (Requires explicit RBAC scope `admin` or `profile:write_danger`)
- `profiles.delete`: Permanently delete profile.
- `profiles.restore`: Restore profile from soft-delete.
- `profiles.export_preserved`: Export historical migration data.
- `profiles.cleanup_preserved`: Purge preserved archive.
- `browser.evaluate_allowlisted`: Execute pre-registered script by its unique registered ID (`script_id`), with structured parameter passing. Arbitrary raw JS strings are REJECTED.

#### Tier 3: Prohibited operations (Globally blocked under all scopes)
- Raw CDP execution (`cdp.send`, `Runtime.evaluate`, `Page.addScriptToEvaluateOnNewDocument`).
- Arbitrary shell/process invocation (`process.exec`, `child_process`).
- Filesystem traversal outside sandbox directories.
- Extraction of raw saved passwords or unmasked proxy credentials.

### 3. Short-lived credentials, audience binding, and nonce replay defense
- Tokens issued for MCP operations have a maximum validity window of 15 minutes (`exp = now + 900s`).
- Bound to specific audience (`aud = "antidetect-mcp"`).
- Each request over HTTP/transport includes a monotonically increasing or UUID-based nonce validated against an in-memory sliding replay window.

### 4. Tamper-evident hash-chained audit logging
- Every invocation is recorded to `<userDataRoot>/logs/mcp_audit.jsonl`.
- Record structure: `{"seq": N, "ts": "...", "tool": "...", "caller": "...", "params_hash": "sha256(...)", "prev_hash": "sha256(...)", "status": "ok|denied|error", "hash": "sha256(...)"}`.
- Chained SHA-256 hashes make any log tampering or deletion immediately detectable.

## Risks / Trade-offs

- [Developers wanting unconstrained CDP] -> Provide clear documentation that script evaluation must register IDs in `scripts/allowlist.json`.
- [Overhead of hash-chained logging] -> Synchronous memory buffer with batched disk append; microsecond overhead per tool call.

## Migration Plan

- Greenfield MCP integration surface.
- Does not modify existing REST APIs or UI interfaces.
- Rollback: Stop MCP daemon or omit `--mcp` launch flag.
