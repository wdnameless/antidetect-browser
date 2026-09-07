## 1. OpenAPI Specification

- [x] 1.1 Draft comprehensive OpenAPI 3.1 schema for AdsPower V1/V2 endpoints in `docs/openapi/api-v1-v2.yaml`.
- [x] 1.2 Validate OpenAPI schema with spectral/openapi-generator linters.

## 2. Node.js SDK (`@antidetect/sdk`)

- [x] 2.1 Scaffold TypeScript project in `sdks/node` with package configuration and build scripts (tsup/tsc).
- [x] 2.2 Implement core HTTP transport with configurable timeouts, retries, and authentication handling.
- [x] 2.3 Implement typed profile management and browser control resource methods.
- [x] 2.4 Implement typed error classes and response deserialization.
- [x] 2.5 Write unit and mock integration tests covering all methods in `sdks/node/test`.

## 3. Python SDK (`antidetect-sdk`)

- [x] 3.1 Scaffold Python project in `sdks/python` with `pyproject.toml` and type annotations.
- [x] 3.2 Implement Pydantic v2 models representing all OpenAPI schemas.
- [x] 3.3 Implement synchronous and asynchronous client classes (`AntidetectClient`, `AsyncAntidetectClient`).
- [x] 3.4 Implement robust error hierarchies and connection retry backoff.
- [x] 3.5 Write unit and pytest integration tests covering all methods in `sdks/python/tests`.

## 4. Conformance & CI Validation

- [x] 4.1 Create cross-SDK conformance verification suite testing both SDKs against identical mock fixtures.
- [x] 4.2 Add CI workflow for automated linting, type-checking, and test execution for both SDKs.
- [x] 4.3 Run `openspec validate add-standalone-node-python-sdks --strict` and verify compliance.
