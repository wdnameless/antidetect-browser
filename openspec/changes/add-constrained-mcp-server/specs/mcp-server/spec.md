## Purpose

Defines requirements and verification criteria for the Constrained Model Context Protocol (MCP) server, including transport isolation, typed tool registry, security prohibitions, 15-minute token scopes, and hash-chained audit trails.

## ADDED Requirements

### Requirement: Transport isolation and loopback boundary
The MCP server MUST default to stdio transport and restrict any optional HTTP transport strictly to the loopback interface `127.0.0.1`.

#### Scenario: Stdio communication
- **GIVEN** an external automation agent launching the MCP server via CLI
- **WHEN** communicating over standard input and standard output
- **THEN** the server MUST exchange JSON-RPC 2.0 frames over stdio without opening listening network ports

#### Scenario: Loopback HTTP binding
- **GIVEN** the MCP server configured with HTTP transport enabled
- **WHEN** binding to an interface
- **THEN** it MUST bind exclusively to `127.0.0.1` and reject requests with unverified or non-loopback `Host` headers

### Requirement: Constrained tool registry and prohibited primitives
The MCP server MUST expose only explicitly enumerated typed tools and reject high-risk system primitives across all scopes.

#### Scenario: Default automation tool execution
- **GIVEN** an authenticated client with scope `mcp:automation`
- **WHEN** invoking allowed tools such as `profiles.list`, `profiles.start`, or `browser.navigate`
- **THEN** the server MUST execute the tool within profile runtime constraints and return structured JSON results

#### Scenario: Prohibited primitive denial
- **GIVEN** an MCP client attempting to invoke shell execution, raw CDP debugging, arbitrary file read, or arbitrary script eval
- **WHEN** the request is received
- **THEN** the server MUST immediately reject the invocation with an unauthorized or method not found error and log a security alert

#### Scenario: Allowlisted evaluate execution
- **GIVEN** an authenticated client with scope `mcp:admin` invoking `browser.evaluate_allowlisted`
- **WHEN** providing a registered script template ID and arguments
- **THEN** the server MUST execute only the pre-compiled template and reject requests containing raw JavaScript strings

### Requirement: Short-lived audience-bound authentication
MCP requests MUST be authenticated using 15-minute bearer tokens bound to the `antidetect-mcp` audience.

#### Scenario: Expired token rejection
- **GIVEN** an MCP client request presenting a token with `iat` older than 15 minutes (900 seconds)
- **WHEN** the token is validated
- **THEN** the server MUST reject the request with HTTP 401 / JSON-RPC error `-32001` (Token Expired)

#### Scenario: Scope authorization check
- **GIVEN** a client authenticated with scope `mcp:automation`
- **WHEN** attempting to invoke elevated tool `profiles.delete`
- **THEN** the server MUST reject the call with HTTP 403 / JSON-RPC error `-32003` (Insufficient Scope)

### Requirement: Tamper-evident hash-chained audit logging
Every MCP tool execution MUST be recorded in a SHA-256 hash-chained audit log with sensitive parameter redaction.

#### Scenario: Parameter redaction and hash verification
- **GIVEN** an MCP tool invocation containing proxy credentials or authentication tokens
- **WHEN** the audit record is committed
- **THEN** sensitive credentials MUST be replaced with redaction masks and `hash` MUST match `SHA-256(prev_hash + canonical_json(entry))`
