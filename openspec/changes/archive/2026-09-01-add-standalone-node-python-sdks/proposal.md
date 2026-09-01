## Why

Developers and automation teams orchestrating antidetect browser profiles need first-class, idiomatic client SDKs in Node.js (TypeScript) and Python. To maintain flawless API contracts and eliminate manual sync drift, these SDKs must be generated and validated directly from versioned OpenAPI schemas, maintain full conformance with existing local API and AdsPower V1/V2 compatibility endpoints, introduce zero breaking API changes, and target only our local API transport.

## What Changes

- Generate official standalone SDKs:
  - Node.js / TypeScript SDK (`@scope/antidetect-sdk` in `packages/sdk-node`).
  - Python SDK (pip package `antidetect-sdk` in `packages/sdk-python`).
- Establish automated OpenAPI generation pipeline from current routes in `src/main/api/server.ts` and `src/main/api/routes/`.
- Ensure 100% endpoint coverage including standard profile management, browser session controls, disposable profiles, proxy verification, and AdsPower V1/V2 compatibility routes.
- Introduce zero breaking changes to existing REST routes or payloads.
- Restrict SDK transport solely to local HTTP/REST API (no cloud dependency, no Rust bindings).

## Capabilities

### New Capabilities
- `standalone-sdks`: Generated Node.js and Python client libraries validated against versioned OpenAPI specs with full AdsPower V1/V2 compatibility conformance.

### Modified Capabilities
- None

## Impact

- Affected directories: `packages/sdk-node/`, `packages/sdk-python/`, `docs/openapi.yaml`, and API test suites.
- Dependencies: Governed under umbrella `openspec/changes/stealth-parity-hardening` (Task 6.2). Builds upon established API baseline (Tasks 1.3/3.2).

## Goals / Non-Goals

**Goals:**
- Provide typed, idiomatic Node.js / TypeScript and Python SDKs.
- Maintain a single authoritative `openapi.yaml` source of truth.
- Verify AdsPower V1/V2 endpoint parity across both SDKs.
- Support typed connection to local API with Bearer token authentication.

**Non-Goals:**
- Developing Rust, Go, or C# SDKs in this change.
- Introducing breaking changes to existing REST endpoints.
- Interfacing with external third-party cloud backends.

## Risks / Trade-offs

- [OpenAPI schema drift] -> Add automated CI check that fails if route changes in `src/main/api/` are not reflected in `openapi.yaml`.
- [AdsPower legacy payload quirks] -> Custom serialization adapters in SDKs for V1/V2 query parameters.

## Migration and rollback

- Standalone SDK packages are additive clients and do not alter server runtime internals.
- Rollback: Revert client package releases without affecting backend functionality.
