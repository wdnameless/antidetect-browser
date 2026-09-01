## 1. MCP transport and protocol dispatch

- [x] 1.1 Implement MCP JSON-RPC 2.0 message parser and protocol dispatcher over stdio and loopback HTTP in `src/main/mcp/server.ts`.
- [x] 1.2 Implement capability negotiation, tool listing (`tools/list`), and execution handler (`tools/call`).

## 2. Tool manifests and RBAC enforcement

- [x] 2.1 Implement Tier 1 default tool handlers (`profiles.*`, `browser.*`, `diagnostics.*`) interfacing with `profileManager.ts` and `cdpTunnel.ts`.
- [x] 2.2 Implement Tier 2 gated tool handlers with RBAC scope checks and script allowlist resolution for `browser.evaluate_allowlisted`.
- [x] 2.3 Implement hard rejection traps for prohibited tools (raw CDP, shell execution, credential dumping).

## 3. Security tokens, nonce validation, and hash-chained audit

- [x] 3.1 Implement 15-minute audience-bound token verification and nonce replay prevention cache.
- [x] 3.2 Implement `McpAuditLogger` recording SHA-256 hash-chained JSONL records for every tool request and result.

## 4. Verification and validation

- [x] 4.1 Write Vitest unit tests in `tests/unit/mcp-server.test.ts` testing tool execution, RBAC gating, and raw CDP rejection.
- [x] 4.2 Write audit log integrity verification test confirming tamper-detection on mutated hash chains.
- [x] 4.3 Run `openspec validate add-constrained-mcp-server --strict` and verify compliance.
