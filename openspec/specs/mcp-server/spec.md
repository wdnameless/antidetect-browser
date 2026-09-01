# mcp-server Specification

## Purpose
Defines the Model Context Protocol (MCP) server integration, tool tiers (default, gated, prohibited), evaluation allowlisting, 15-minute audience credentials, nonce replay defense, RBAC scoping, and tamper-evident hash-chained audit logging.

## Requirements

### Requirement: MCP protocol transport and tool dispatch
The system MUST provide an MCP server over stdio and loopback HTTP supporting standard `tools/list` and `tools/call` methods.

#### Scenario: Tool listing discovers allowed tools
- **GIVEN** an active MCP server session
- **WHEN** a client issues `tools/list`
- **THEN** the server MUST return schemas for all registered default and gated tools
- **AND** MUST NOT expose raw CDP or arbitrary execution tools

#### Scenario: Executing standard profile creation tool
- **GIVEN** a valid client MCP connection
- **WHEN** the client calls `tools/call` with name `profiles.create` and valid parameters
- **THEN** the server MUST create the profile and return its identifier and metadata

### Requirement: Gated tools and RBAC scope authorization
Privileged actions MUST require explicit RBAC scope verification prior to execution.

#### Scenario: Unscoped client rejected on gated tool
- **GIVEN** an MCP client authenticated with default `standard` scope
- **WHEN** the client attempts to call `profiles.delete`
- **THEN** the server MUST reject the call with an authorization error (`FORBIDDEN`)
- **AND** MUST record the denial in the audit log

#### Scenario: Allowlisted script evaluation execution
- **GIVEN** an MCP client with `script:execute` scope and a registered script ID `extract_form_inputs`
- **WHEN** the client calls `browser.evaluate_allowlisted` with `script_id: "extract_form_inputs"`
- **THEN** the server MUST execute the pre-registered script and return its result

#### Scenario: Arbitrary JavaScript injection rejected
- **GIVEN** any MCP client
- **WHEN** the client attempts to pass arbitrary JavaScript code or unknown `script_id`
- **THEN** the server MUST immediately reject the request without executing code

### Requirement: Prohibited operations enforcement
The server MUST permanently block raw CDP methods, shell command execution, and raw credential retrieval regardless of caller scopes.

#### Scenario: Raw CDP send blocked
- **GIVEN** an administrator MCP session
- **WHEN** the client attempts to call any raw CDP method or unconstrained evaluator
- **THEN** the server MUST return a prohibited operation error

### Requirement: Credential lifetime, nonce replay defense, and audit logging
Tokens MUST NOT exceed 15 minutes validity, nonces MUST prevent replay, and all invocations MUST append to a hash-chained audit log.

#### Scenario: Expired token rejection
- **GIVEN** a token issued 16 minutes prior
- **WHEN** the client attempts an MCP request
- **THEN** the server MUST reject the token with an authentication failure

#### Scenario: Replayed nonce rejection
- **GIVEN** a request with nonce `nonce-12345` already processed
- **WHEN** a second request arrives with identical nonce `nonce-12345`
- **THEN** the server MUST reject the duplicate request

#### Scenario: Hash-chained audit verification
- **GIVEN** multiple executed MCP tool calls
- **WHEN** audit records are written to disk
- **THEN** each record's `prev_hash` MUST match the preceding record's SHA-256 hash
