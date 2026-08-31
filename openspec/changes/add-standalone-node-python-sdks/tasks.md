## 1. OpenAPI definition and code generation tooling

- [ ] 1.1 Assemble comprehensive OpenAPI 3.1 specification in `docs/openapi.yaml` covering core REST routes and AdsPower V1/V2 endpoints.
- [ ] 1.2 Set up generation scripts for Node.js (`packages/sdk-node`) and Python (`packages/sdk-python`).

## 2. Node.js / TypeScript SDK implementation

- [ ] 2.1 Implement core HTTP client wrapper with Bearer token authentication and base URL configuration.
- [ ] 2.2 Implement typed domain modules: profiles, browser launcher, proxy, and AdsPower V1/V2 adapter.
- [ ] 2.3 Write Node.js unit and integration tests in `packages/sdk-node/test/`.

## 3. Python SDK implementation

- [ ] 3.1 Implement Python client models and sync/async client transports.
- [ ] 3.2 Implement AdsPower compatibility client methods and error handling.
- [ ] 3.3 Write Python unit and integration tests in `packages/sdk-python/tests/`.

## 4. Conformance verification and CI automation

- [ ] 4.1 Validate Node and Python SDKs against running local API server test instance.
- [ ] 4.2 Validate AdsPower V1/V2 test fixtures across both SDKs to verify 100% payload compatibility.
- [ ] 4.3 Run `openspec validate add-standalone-node-python-sdks --strict` and verify compliance.
