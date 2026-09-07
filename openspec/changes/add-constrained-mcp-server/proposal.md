## Why

External automation, AI agents, and workflow integrators currently lack a safe, standardized protocol to inspect, control, and orchestrate browser profiles. While third-party tools frequently demand raw CDP access or unbounded arbitrary process/code execution, doing so in an enterprise antidetect browser exposes users to complete system compromise, credential exfiltration, and undetectable browser hijacking.

We need a Model Context Protocol (MCP) server that provides tightly constrained, auditable, and capability-gated tools specifically designed for antidetect browser orchestration, without exposing high-risk system primitives.

## What Changes

- Introduce a constrained MCP server with stdio as the primary default transport and optional loopback HTTP (`127.0.0.1`).
- Enforce strict tool boundaries:
  - Allowed default read/orchestration tools: `profiles.list`, `profiles.get`, `profiles.create`, `profiles.start`, `profiles.stop`, `browser.navigate`, `browser.click`, `browser.type`, `browser.screenshot`, `diagnostics.run`.
  - Allowed separately gated/elevated tools: `profiles.delete`, `profiles.restore`, `profiles.export_preserved`, `profiles.cleanup_preserved`, and server-allowlist-ID-only `browser.evaluate_allowlisted`.
  - Explicitly PROHIBITED across all scopes: generic process execution, direct filesystem access, arbitrary network requests, raw credential retrieval, unbounded script evaluation, and raw CDP pass-through.
- Implement short-lived, audience-bound 15-minute bearer tokens with tenant/client/scope binding, nonces for replay prevention, rate-limiting, and immediate token revocation.
- Add tamper-evident hash-chained audit logging retaining all MCP tool invocations for 24 months with mandatory parameter redaction for sensitive fields (tokens, passwords, proxy credentials).

## Capabilities

### New Capabilities
- `mcp-server`: Constrained Model Context Protocol (MCP) server exposing bounded browser automation tools, loopback/stdio transport, 15-minute token scopes, and hash-chained audit trails.

### Modified Capabilities
- None

## Impact

- Affected code: `src/main/mcp/` (server implementation, protocol handlers, tool registry, token auth, audit logger), `src/main/index.ts` (lifecycle integration).
- System interactions: Communicates with profile manager and browser launcher via internal TypeScript APIs. Exposes stdio interface for local CLI agents and optional loopback HTTP for local services.
- Dependencies: Governed under umbrella `openspec/changes/stealth-parity-hardening` (Task 6.3). Depends on standalone SDK definitions and frozen AdsPower API contracts (Task 6.1/6.2).

## Goals / Non-Goals

**Goals:**
- Provide a standard JSON-RPC 2.0 MCP interface for AI coding agents and external automation tools.
- Constrain all automation capabilities to strictly typed and enumerated actions.
- Enforce loopback/stdio boundary to prevent remote unauthorized invocation.
- Provide cryptographically verified audit logging for enterprise governance.

**Non-Goals:**
- Exposing raw CDP sockets or arbitrary V8 debugger handles.
- Enabling remote WAN network access to the MCP server.
- Supporting arbitrary JavaScript evaluation in pages (only allowlisted script templates by ID).

## Risks / Trade-offs

- [Automation flexibility vs safety] -> Power users wanting arbitrary CDP access cannot use this MCP server. Mitigation: Allowlisted parameterized actions cover 99% of automation workflows.
- [Token expiration overhead] -> 15-minute token lifespan requires clients to refresh tokens periodically. Mitigation: Deterministic token refresh handshake supported over stdio and loopback.

## Migration and rollback

- This is an additive change with zero impact on existing profile storage or browser launching.
- Rollback: Disable MCP server initialization flag in `src/main/index.ts`.
