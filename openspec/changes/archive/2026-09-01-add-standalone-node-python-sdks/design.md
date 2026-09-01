## Context

Automation workflows rely heavily on scripting environments, predominantly Node.js / TypeScript and Python. Currently, users must construct raw HTTP requests or adapt third-party libraries. Providing official SDKs generated from authoritative OpenAPI specifications ensures reliable integration, typed error handling, and guaranteed compatibility with AdsPower V1/V2 workflows.

Public dated observations (2026-08) from ShardBrowser/ShardX highlight the value of standardized SDK layers.

## Decisions

### 1. OpenAPI 3.1 specification as authoritative contract
Maintain `docs/openapi.yaml` documenting all endpoints:
- Core profile lifecycle: `GET /profiles`, `POST /profiles`, `POST /profiles/temporary`, `DELETE /profiles/:id`.
- Browser execution: `POST /browser/start`, `POST /browser/stop`, `GET /browser/active`.
- Proxy diagnostics: `POST /proxy/verify`.
- AdsPower V1/V2 compatibility layer: `GET /api/v1/user/list`, `GET /api/v1/browser/start`, `GET /api/v1/browser/stop`, `GET /api/v1/browser/active`, `POST /api/v1/user/create`, `POST /api/v1/user/update`, `POST /api/v1/user/delete`.

### 2. Node.js SDK (`@scope/antidetect-sdk`)
- Written in TypeScript with zero heavy runtime dependencies (native `fetch`).
- Full Promise-based async API with TypeScript type definitions for all request/response models.
- Support both modern client methods (`client.profiles.create(...)`) and AdsPower compatibility namespaces (`client.adspower.userList(...)`).

### 3. Python SDK (`antidetect-sdk`)
- Python 3.9+ compatible using `httpx` or `urllib3`.
- Type annotations (`typing`) and Pydantic models / dataclasses for response parsing.
- Synchronous and asynchronous clients (`AntidetectClient` and `AsyncAntidetectClient`).

### 4. Zero breaking API changes
- SDK generation relies strictly on the existing server endpoints in `src/main/api/server.ts`.
- No route renames or schema breaking modifications are permitted.

## Risks / Trade-offs

- [Generated code readability] -> Use clean code generation templates with post-generation formatting (Prettier / Ruff / Black).
- [AdsPower V1/V2 query param legacy behavior] -> Dedicated test suite validating exact query string formatting and response body wrapping.

## Migration Plan

- Greenfield client libraries in `packages/`.
- No migration required for existing server installations.
