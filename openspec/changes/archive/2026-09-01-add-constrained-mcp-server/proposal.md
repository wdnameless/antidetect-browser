## Why

AI agents and automated assistant pipelines require programmatic control over browser profiles, navigation, and diagnostics via the standard Model Context Protocol (MCP). However, exposing unconstrained raw CDP commands, arbitrary shell execution, direct filesystem manipulation, or unmanaged credential access creates severe security vulnerabilities. This change introduces a security-hardened, constrained MCP server over stdio (and optional loopback HTTP) with strictly scoped tool definitions, RBAC-gated privileged actions, time-bound audience credentials, nonce replay defense, allowlisted evaluation, and tamper-evident hash-chained audit logging.

## What Changes

- Implement an MCP server adhering to the Model Context Protocol specification over stdio transport and optional loopback HTTP.
- Define a constrained tool manifest dividing capabilities into default tools, gated tools, and strictly prohibited operations:
  - **Default tools**: `profiles.list`, `profiles.get`, `profiles.create`, `profiles.start`, `profiles.stop`, `browser.navigate`, `browser.click`, `browser.type`, `browser.screenshot`, `diagnostics.run`.
  - **Gated tools (RBAC + explicit scope)**: `profiles.delete`, `profiles.restore`, `profiles.export_preserved`, `profiles.cleanup_preserved`, `browser.evaluate_allowlisted` (restricted to server-registered script IDs).
  - **Prohibited operations**: Raw CDP methods (`*`), arbitrary script evaluation (`Runtime.evaluate`), raw shell/process execution, direct filesystem traversal, and credential extraction.
- Implement short-lived (15-minute) audience-bound credentials with nonce-based replay prevention.
- Integrate role-based access control (RBAC) validating token scopes before executing any gated tool.
- Implement a tamper-evident, hash-chained append-only audit log recording every MCP tool invocation, parameter hash, caller identity, timestamp, and execution result.
- Build upon existing security infrastructure in `src/main/api/server.ts` and `src/main/api/cdpTunnel.ts`.

## Capabilities

### New Capabilities
- `mcp-server`: Constrained MCP server protocol handling over stdio/HTTP, default/gated tool schemas, evaluate allowlisting, short-lived tokens with nonce defense, RBAC scoping, and hash-chained audit trails.

### Modified Capabilities
- None

## Impact

- Affected systems: `src/main/api/server.ts`, `src/main/api/cdpTunnel.ts`, `src/main/api/routes/profiles.ts`, and new MCP service module `src/main/mcp/`.
- Dependencies: Governed under umbrella `openspec/changes/stealth-parity-hardening` (Task 6.3). Reuses API Bearer authentication and rate limiting.

## Goals / Non-Goals

**Goals:**
- Provide a standardized MCP interface over stdio and loopback HTTP for LLM agent integration.
- Expose safe default tools for profile lifecycle and high-level browser actions.
- Enforce strict allowlisting for JavaScript evaluation (registered IDs only, never raw code).
- Enforce 15-minute token expiry and nonce validation.
- Maintain tamper-evident hash-chained audit logging.

**Non-Goals:**
- Exposing raw unconstrained CDP socket to AI agents.
- Supporting remote unauthenticated network access.
- Implementing arbitrary file system or shell execution tools.

## Risks / Trade-offs

- [Agent workflows hindered by evaluation restrictions] -> Pre-register standard automation scripts with verifiable IDs in server configuration.
- [Audit log growth under heavy automated traffic] -> Structured compact JSON log rotation with cryptographic integrity seal preservation.

## Migration and rollback

- MCP server is an opt-in integration surface configured via CLI flags or configuration file.
- Rollback: Disabling the MCP transport leaves all standard REST APIs and UI workflows completely unaffected.
