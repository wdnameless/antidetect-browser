## Purpose

Defines requirements and verification criteria for standalone Node.js and Python SDKs conforming to the OpenAPI 3.1 contract.

## ADDED Requirements

### Requirement: OpenAPI 3.1 contract definition
The project MUST maintain a single, authoritative OpenAPI 3.1 specification for all local automation REST endpoints.

#### Scenario: OpenAPI spec validity
- **GIVEN** the OpenAPI file in `docs/openapi/api-v1-v2.yaml`
- **WHEN** validated by an OpenAPI 3.1 schema validator
- **THEN** it MUST pass validation without syntax errors or broken schema references

### Requirement: Standalone Node.js SDK
The project MUST provide an independently installable TypeScript/Node.js client library (`@antidetect/sdk`) supporting Node.js >= 18.

#### Scenario: Node.js SDK profile management
- **GIVEN** an instance of `AntidetectClient` configured with base URL and API key
- **WHEN** invoking `client.profiles.create(params)` and `client.browser.start(profileId)`
- **THEN** it MUST send properly typed HTTP requests to the daemon and resolve with structured responses containing the CDP WebSocket debugging address

#### Scenario: Node.js SDK retry and error handling
- **GIVEN** a temporary network refusal or 503 response from the local daemon
- **WHEN** a client method is executed with retry enabled
- **THEN** the SDK MUST automatically retry with exponential backoff up to the configured limit before throwing a typed `AntidetectApiError`

### Requirement: Standalone Python SDK
The project MUST provide an independently installable Python client library (`antidetect-sdk`) supporting Python >= 3.9.

#### Scenario: Python SDK synchronous and asynchronous clients
- **GIVEN** `AntidetectClient` and `AsyncAntidetectClient` instances
- **WHEN** calling profile creation and browser control methods
- **THEN** both synchronous and asynchronous invocations MUST succeed and return parsed Pydantic v2 models

#### Scenario: Python SDK parameter validation
- **GIVEN** an invalid payload missing required fields according to the OpenAPI schema
- **WHEN** instantiating request models in Python
- **THEN** the SDK MUST raise a `pydantic.ValidationError` before sending HTTP traffic

### Requirement: Cross-SDK conformance testing
CI MUST run an automated test suite verifying behavioral equivalence between Node.js and Python SDK implementations against mock endpoints.

#### Scenario: Conformance test pass
- **GIVEN** identical test fixtures and mock API endpoints
- **WHEN** executing conformance suites in both SDK test environments
- **THEN** both SDKs MUST generate identical HTTP wire payloads and parse standard responses identically
