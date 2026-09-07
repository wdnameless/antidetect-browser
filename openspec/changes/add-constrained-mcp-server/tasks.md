## 1. Core Server & Transport

- [x] 1.1 Implement MCP JSON-RPC 2.0 protocol handler and stdio transport adapter in `src/main/mcp/server.ts`.
- [x] 1.2 Implement optional loopback HTTP transport binding strictly to `127.0.0.1` with DNS rebinding defenses.

## 2. Tool Registry & Guardrails

- [x] 2.1 Implement tool registration framework enforcing strictly typed input schemas and output validation.
- [x] 2.2 Implement default automation tools (`profiles.list`, `profiles.get`, `profiles.create`, `profiles.start`, `profiles.stop`, `browser.navigate`, `browser.click`, `browser.type`, `browser.screenshot`, `diagnostics.run`).
- [x] 2.3 Implement elevated administrative tools (`profiles.delete`, `profiles.restore`, `profiles.export_preserved`, `profiles.cleanup_preserved`).
- [x] 2.4 Implement `browser.evaluate_allowlisted` referencing server-registered template IDs with input parameters and reject arbitrary code execution.
- [x] 2.5 Assert hard fail-closed enforcement rejecting generic process, filesystem, raw network, and CDP primitives.

## 3. Auth, Scopes & Audit Logging

- [x] 3.1 Implement 15-minute audience-bound token verification with scope checking (`mcp:automation`, `mcp:admin`).
- [x] 3.2 Implement nonce replay defense and token revocation list.
- [x] 3.3 Implement parameter redaction filters for sensitive fields (tokens, passwords, proxy credentials).
- [x] 3.4 Implement tamper-evident SHA-256 hash-chained audit logging with 24-month retention policy.

## 4. Verification & Validation

- [x] 4.1 Unit tests for tool routing, authorization scopes, parameter redaction, and audit hash verification in `tests/unit/mcp/`.
- [x] 4.2 Security regression tests verifying denial of arbitrary script evaluation, raw CDP access, and network bypasses.
- [x] 4.3 Run `openspec validate add-constrained-mcp-server --strict` and verify compliance.
