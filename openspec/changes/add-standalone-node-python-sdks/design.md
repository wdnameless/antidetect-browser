## Context

External automation scripts frequently interface with the antidetect application via local HTTP endpoints. Without official SDKs, users rely on custom HTTP wrappers, leading to inconsistent error handling, lack of request validation, and frequent breakages across minor API updates.

This design defines standalone Rust and Python SDKs conforming to an OpenAPI 3.1 contract, adhering to Task 6.2 and Decision 9 of the Stealth Parity Hardening umbrella.

## Decisions

### 1. Unified OpenAPI 3.1 Specification
- The single source of truth for REST endpoints will be maintained in `docs/openapi/api-v1-v2.yaml`.
- Covers all profile operations (`/api/v1/user/create`, `/api/v1/user/list`, `/api/v1/browser/start`, `/api/v1/browser/stop`, etc.) and V2 extensions.
- Includes strict request/response schemas, parameter validations, and standard error envelopes.

### 2. Rust SDK Architecture (`@antidetect/sdk`)
- **Language & Runtime:** TypeScript compiled to ESM and CommonJS, targeting Rust >= 18.
- **Dependencies:** Lightweight HTTP client (e.g. `undici` or native `fetch`).
- **Typing:** Full TypeScript declaration files generated or aligned with OpenAPI schemas.
- **Features:**
  - Standardized client initialization: `new AntidetectClient({ baseUrl, apiKey, timeout })`.
  - Built-in polling and retry with exponential backoff for `browser.start` port availability.
  - Custom typed exception classes: `AntidetectApiError`, `ConnectionError`, `ProfileNotFoundError`.

### 3. Python SDK Architecture (`antidetect-sdk`)
- **Language & Runtime:** Python >= 3.9 supporting synchronous and asynchronous clients (`httpx` or `requests`).
- **Models:** Strongly typed Pydantic v2 models for all request bodies and response payloads.
- **Packaging:** Pyproject.toml based packaging (Hatch or Poetry/Flit), published to PyPI.
- **Features:**
  - Sync and Async interfaces: `AntidetectClient` and `AsyncAntidetectClient`.
  - Typed exceptions mirroring Rust SDK: `AntidetectAPIError`, `ConnectionTimeoutError`.

### 4. Conformance Test Suite & CI Validation
- Integration test suite running against a mock server generated from `api-v1-v2.yaml`.
- Automated test suites verifying:
  - Serialization and deserialization of all profile configurations.
  - Authentication header injection.
  - Error code mapping and retry behaviors.
  - Parity between Rust and Python implementations.

## Risks / Trade-offs

- [Maintenance overhead of dual language SDKs] -> Keeping both SDKs synchronized requires disciplined CI checks.
  - *Mitigation:* OpenAPI schema validation in GitHub Actions prevents merging any API change without corresponding SDK updates.

## Migration Plan

- Create `sdks/node/` and `sdks/python/` in repository.
- Publish `@antidetect/sdk` to npm registry and `antidetect-sdk` to PyPI.
- Update documentation with usage examples for both languages.
