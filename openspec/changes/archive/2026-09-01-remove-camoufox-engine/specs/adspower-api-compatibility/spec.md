## Purpose

Defines stable AdsPower V1/V2 request, response, error, documentation, and side-effect compatibility while retired Firefox behavior becomes explicit refusal.

## ADDED Requirements

### Requirement: Clone-only signed legacy corpus and discovered refusal
Before production denial/deletion, the approved baseline child MUST run all mutating fixtures only in a fully isolated disposable clone and freeze create/start/stop/import/duplicate/bulk/script/sync plus `/status`, geolocation, and rate-limit behavior. It MUST record request bytes/content type/headers, HTTP status, response content type/headers, envelope, application code/body, ordering/side effects, precedence, and mixed Chromium/Firefox bulk semantics. Removal MUST NOT invent behavior; it MUST wait until corpus evidence pins exact refusal mapping.

#### Scenario: Negative input - malformed legacy field
- **WHEN** a legacy Firefox field has invalid type or encoding
- **THEN** the frozen validation error MUST take precedence over the corpus-pinned removed-engine refusal

#### Scenario: State or race - repeated corpus capture
- **WHEN** corpus capture runs concurrently or is retried
- **THEN** identical fixtures MUST deduplicate by digest and conflicting observations MUST block signing

#### Scenario: Boundary or null - null legacy field
- **WHEN** an optional legacy field is null or absent
- **THEN** acceptance/default/refusal MUST exactly match the signed operation-specific corpus

#### Scenario: Auth or permission - unauthorized request
- **WHEN** authentication or RBAC fails
- **THEN** existing auth status/body MUST precede engine refusal and no engine existence MUST leak

#### Scenario: Documentation drift
- **WHEN** `/status`, geolocation, or rate-limit documentation differs from observed signed behavior
- **THEN** child approval MUST be blocked until code or documentation is reconciled and replay passes
