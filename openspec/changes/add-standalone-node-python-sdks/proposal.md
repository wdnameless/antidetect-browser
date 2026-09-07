## Why

Automators, bot developers, and enterprise QA teams interact with our antidetect browser via HTTP REST APIs (AdsPower V1/V2 compatibility endpoints). Currently, users must write boilerplate HTTP code, parse custom JSON error formats, handle port polling, and manually construct request payloads.

To ensure seamless adoption and maintain API conformance across releases, we need officially supported, standalone Rust and Python SDKs generated from a single versioned OpenAPI specification.

## What Changes

- Author an authoritative OpenAPI 3.1 specification for the local REST API (`v1` and `v2` endpoints: profile management, browser lifecycle, proxy configuration, diagnostics).
- Deliver standalone, independently versioned Rust (`@antidetect/sdk`) and Python (`antidetect-sdk`) client libraries.
- Standardize authentication (API key / bearer tokens), connection retries, error parsing, and type definitions (TypeScript types and Python Pydantic models / type annotations).
- Integrate SDK conformance test suites into CI to ensure client libraries strictly adhere to the OpenAPI specification and backend behavior.
- In accordance with the umbrella governance decision (Decision 9, Task 6.2), explicitly exclude Rust SDK development to avoid maintenance fragmentation.

## Capabilities

### New Capabilities
- `standalone-sdks`: Standalone, strongly typed Rust and Python SDKs with unified error handling, automated connection retries, and OpenAPI conformance validation.

### Modified Capabilities
- None

## Impact

- Repository structure: Adds `sdks/node/` (TypeScript / npm package) and `sdks/python/` (Python / PyPI package), plus `docs/openapi.yaml`.
- Backend changes: None directly to core browser runtime; serves as client library harness over existing AdsPower V1/V2 and internal REST controllers.
- Dependencies: Governed under umbrella `openspec/changes/stealth-parity-hardening` (Task 6.2).

## Goals / Non-Goals

**Goals:**
- Provide ergonomic, idiomatic Rust and Python libraries for browser profile orchestration.
- Enforce strict typing (TypeScript interfaces and Python type hints / Pydantic models) matching OpenAPI.
- Provide automated retry logic with exponential backoff for transient local server connectivity issues.
- Guarantee 100% test coverage against mock and live AdsPower V1/V2 endpoints.

**Non-Goals:**
- Supporting Rust, Go, or C# SDKs (explicitly deferred/rejected per umbrella decisions).
- Introducing breaking changes to existing AdsPower V1/V2 endpoints.

## Risks / Trade-offs

- [SDK Drift against backend updates] -> Backend endpoint updates might drift from SDK definitions. Mitigation: Automated CI check verifying OpenAPI spec against SDK code generation / types.

## Migration and rollback

- SDK packages are distributed as independent libraries (`sdks/node`, `sdks/python`).
- Rollback: Revert published package versions or deprecate release tags in npm/PyPI without impacting core browser app.
