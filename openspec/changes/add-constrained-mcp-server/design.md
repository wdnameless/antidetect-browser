## Context

Integrators and autonomous agent frameworks require programmatic browser orchestration. Conventional MCP servers often expose shell execution or raw browser automation primitives (such as Playwright or raw CDP access). In an antidetect browser, exposing raw CDP compromises stealth guarantees and exposes sensitive session/proxy credentials.

This design implements a constrained MCP server according to the approved Stealth Parity governance specification (Decision 9).

## Decisions

### 1. Transport & Network Boundary
- **Stdio transport (default):** Zero open ports, launched as a child process of the agent or host application.
- **Loopback HTTP transport (optional):** Binds strictly to `127.0.0.1`. Rejects non-loopback bindings and checks `Host` headers to prevent DNS rebinding attacks.

### 2. Tool Classification & Allowlist
Tools are divided into two permission tiers:
1. **Default Tier (Standard Automation Scope `mcp:automation`):**
   - `profiles.list`: Returns paginated profile summaries.
   - `profiles.get`: Fetches profile configuration and runtime status.
   - `profiles.create`: Creates a profile adhering to catalog coherence.
   - `profiles.start`: Launches profile in isolated Chromium runtime.
   - `profiles.stop`: Terminates active profile browser instance.
   - `browser.navigate`: Navigates active tab to target URL.
   - `browser.click`: Clicks an element matching a CSS or text selector.
   - `browser.type`: Types text into an element.
   - `browser.screenshot`: Captures viewport screenshot returning base64/PNG artifact.
   - `diagnostics.run`: Runs profile preflight and health checks.

2. **Elevated Tier (Admin/Destructive Scope `mcp:admin`):**
   - `profiles.delete`: Soft-deletes a profile.
   - `profiles.restore`: Restores a soft-deleted profile.
   - `profiles.export_preserved`: Exports preserved profile state.
   - `profiles.cleanup_preserved`: Permanently purges preserved profiles.
   - `browser.evaluate_allowlisted`: Executes a pre-registered script template identified by an integer/string ID from the server-side allowlist. Never accepts raw arbitrary JavaScript code.

3. **Prohibited Primitives (Hard Fail-Closed):**
   - No process spawning or shell execution.
   - No direct host filesystem reads or writes outside designated export directories.
   - No direct outbound network requests from the MCP server process.
   - No retrieval of plaintext proxy credentials or master encryption keys.
   - No raw CDP or WebSocket debugging endpoint exposure.

### 3. Authentication, Scopes, and Token Lifecycle
- Authentication uses Bearer tokens bound to `audience: "antidetect-mcp"`.
- Tokens expire in exactly 15 minutes (`exp = iat + 900`).
- Token claims include: `sub` (client ID), `aud` ("antidetect-mcp"), `tenant_id`, `scopes` (`mcp:automation`, `mcp:admin`), `nonce` (unique per request/handshake).
- Tokens are verifiable via local secret/HMAC or asymmetric key.
- Server maintains an in-memory revocation list synced to disk for revoked tokens.
- Token replay is blocked by requiring a monotonically increasing sequence or request nonce.

### 4. Tamper-Evident Hash-Chained Audit Logging
- Every invocation (timestamp, client ID, tool name, sanitized parameters, execution status, elapsed ms) is logged.
- Sensitive fields (passwords, proxy tokens, cookies, auth headers) are redacted via recursive schema masks before serialization.
- Each audit entry contains `prev_hash` = `SHA-256(previous_entry)` and its own `hash = SHA-256(prev_hash + canonical_json(entry))`.
- Logs are retained in SQLite or append-only log files for 24 months.

## Risks / Trade-offs

- [Restricted evaluation limits dynamic web scraping] -> Integrators cannot run ad-hoc JS snippets.
  - *Mitigation:* Allowlisted parameter-driven script templates in `src/main/mcp/templates/` solve common needs (e.g., scroll, extract table, wait for dynamic element).
- [15-minute token expiry causes session drops if unhandled] ->
  - *Mitigation:* Clear RFC 6750 error responses with `error="invalid_token"` prompt clients to execute the standard refresh flow.

## Migration Plan

- MCP server code lives in `src/main/mcp/`.
- Entry point `src/main/mcp/server.ts` exposes standard stdio and optional loopback HTTP handlers.
- No database migrations required; audit table added via standard migration suite if persistent storage is enabled.
