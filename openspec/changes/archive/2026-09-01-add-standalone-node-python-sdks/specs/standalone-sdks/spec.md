## Purpose

Defines standalone Node.js and Python SDKs generated from OpenAPI specifications with full AdsPower V1/V2 compatibility conformance, zero breaking API changes, and exclusive local HTTP transport.

## ADDED Requirements

### Requirement: OpenAPI contract validation
The server REST API MUST be fully described by a versioned OpenAPI 3.1 schema covering all active endpoints.

#### Scenario: OpenAPI schema completeness
- **GIVEN** the API route definitions in `src/main/api/`
- **WHEN** validating `docs/openapi.yaml`
- **THEN** every active endpoint MUST have an exact corresponding OpenAPI path and operation definition

### Requirement: Node.js SDK functional conformance
The Node.js SDK MUST provide typed access to all local API capabilities and AdsPower compatibility endpoints.

#### Scenario: Managing profiles via Node SDK
- **GIVEN** an initialized Node.js SDK client pointing to `http://127.0.0.1:3000`
- **WHEN** invoking `client.profiles.create({ name: "test-profile" })`
- **THEN** the SDK MUST issue an authenticated POST request and return the typed profile object

#### Scenario: AdsPower V1 compatibility via Node SDK
- **GIVEN** an initialized Node.js SDK client
- **WHEN** invoking `client.adspower.userList({ page: 1, page_size: 10 })`
- **THEN** the SDK MUST query `/api/v1/user/list` and return response formatted to AdsPower V1 schema

### Requirement: Python SDK functional conformance
The Python SDK MUST provide idiomatic sync and async clients matching the OpenAPI schema.

#### Scenario: Launching browser via Python SDK
- **GIVEN** an initialized Python `AntidetectClient`
- **WHEN** calling `client.browser.start(profile_id="prof_123")`
- **THEN** the client MUST return a typed browser connection object containing WebSocket endpoint and process ID

#### Scenario: AdsPower V2 compatibility via Python SDK
- **GIVEN** an initialized Python client
- **WHEN** calling `client.adspower.browser_start(user_id="user_123")`
- **THEN** the client MUST query `/api/v1/browser/start` with user ID parameters and return matching status
