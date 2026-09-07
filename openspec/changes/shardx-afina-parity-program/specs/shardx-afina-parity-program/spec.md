## Purpose

Defines the delivery, ownership, and verification contracts for the ShardX/Afina parity program: bounded children, parallel wave execution with serialized integration points, test-gated merges, and the engine-parity fallback policy.

## ADDED Requirements

### Requirement: Bounded child delivery
The program SHALL implement every capability through a bounded child OpenSpec change on a dedicated feature branch; the umbrella MUST NOT authorize implementation of any child without that child's own validated artifacts.

#### Scenario: Implementation attempted without a child
- **GIVEN** the umbrella artifacts are approved
- **WHEN** implementation is requested for a capability with no child change directory
- **THEN** implementation MUST be blocked and the missing child MUST be named

### Requirement: Serialized integration ownership
Concurrent wave children MUST NOT edit the same integration file in parallel; `src/main/api/server.ts` route mounting and renderer route/navigation registration MUST be owned by exactly one child at merge time.

#### Scenario: Two children need route registration
- **GIVEN** two parallel children each add an API route
- **WHEN** their branches merge
- **THEN** route registration conflicts MUST be resolved by the designated integration owner and the merged suite MUST pass

### Requirement: Test-gated merges
Every child merge to main MUST pass the full deterministic suite (`npm test`, baseline 601 green plus the child's additions) and `npm run typecheck` with zero errors; a red suite MUST block the merge.

#### Scenario: Child suite red
- **GIVEN** a child branch whose added tests fail
- **WHEN** merge is requested
- **THEN** the merge MUST be blocked until the suite is green on the child branch

### Requirement: Engine-parity fallback policy
Until the private-engine patch chain lands, engine-owned surfaces (WebGPU, WebAuthn, native Motion) MUST ship as JS-interim hooks that satisfy `interim-stealth-hardening` rules (native `toString`, explicit `TODO(engine-parity)` markers) and MUST be swappable by the engine patch without API-visible change.

#### Scenario: Interim hook lacks its marker
- **GIVEN** a JS-interim WebGPU hook in `stealthInjection.ts`
- **WHEN** the hook source is inspected
- **THEN** it MUST contain a `TODO(engine-parity: <surface>)` comment referencing its engine patch task

### Requirement: Archive order
Children MUST archive in dependency order (Wave A/B before Wave C where a Wave C child depends on merged Wave A/B surfaces); the umbrella MUST archive last after every child completes or is explicitly superseded.

#### Scenario: Umbrella archived early
- **WHEN** any child remains incomplete
- **THEN** umbrella archive MUST be blocked