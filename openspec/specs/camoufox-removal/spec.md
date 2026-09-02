# camoufox-removal Specification

## Purpose
Removes the unsupported Camoufox product path while preserving raw user data and providing secure, explicit export, cleanup, and rollback behavior.

## Requirements

### Requirement: Complete pre-removal inventory and barrier
After separate approval of both children, the baseline MUST create a fully isolated disposable clone of executable/build, DB, and profile filesystem. All mutating legacy fixtures MUST run only in that clone. Production denial or deletion MUST NOT begin until a verified `LEGACY_CORPUS_SIGNED` envelope exists.

#### Scenario: Negative input - unclassified path
- **GIVEN** inventory scanning finds a Camoufox reference without disposition
- **WHEN** the removal gate is evaluated
- **THEN** the gate MUST fail and no deletion MUST occur

#### Scenario: State or race - corpus capture overlaps disable
- **GIVEN** corpus capture is in progress
- **WHEN** disable is requested concurrently
- **THEN** production behavior MUST remain unchanged, mutating fixtures MUST remain clone-only, and production denial/deletion MUST wait for the signed barrier

#### Scenario: Boundary or null - empty installation
- **GIVEN** no Firefox rows or data roots exist
- **WHEN** inventory runs
- **THEN** it MUST emit a valid zero-item snapshot rather than skip required path categories

#### Scenario: Auth or permission - unauthorized removal gate
- **GIVEN** a caller lacks release-maintainer permission
- **WHEN** it attempts to advance removal state
- **THEN** the transition MUST be denied and audited

### Requirement: Corpus-owned refusal without conversion
After the signed barrier, new/imported/duplicated Firefox/Camoufox profiles MUST be rejected and all listed operations MUST follow corpus-pinned V1/V2 status, headers, content type, envelope, application code, precedence, side effects, and mixed-bulk semantics. No value may be invented before corpus discovery. The system MUST NOT auto-convert profiles.

#### Scenario: Negative input - legacy engine request
- **WHEN** a valid authenticated V1 or V2 request identifies Firefox
- **THEN** it MUST return the corpus-pinned refusal with no prohibited state mutation

#### Scenario: State or race - concurrent start and disable
- **WHEN** start races the atomic disable transition
- **THEN** no Firefox process MUST survive and the response MUST reflect one committed state revision

#### Scenario: Boundary or null - absent engine field
- **WHEN** a create request omits the engine field
- **THEN** existing default semantics MUST be preserved and MUST NOT be misclassified as Firefox

#### Scenario: Auth or permission - invalid token
- **WHEN** an unauthenticated request references a Firefox profile
- **THEN** authentication failure MUST be returned before engine details are disclosed

### Requirement: Durable preserved-browser-data registry
Raw Firefox data MUST be registered independently of profile/trash metadata with all fields in design.md and preserved indefinitely. Export/restore/cleanup MUST require scoped authentication, recent re-authentication, ownership, canonical-root containment, traversal/junction/reparse rejection, audit, and rollback journal. Cleanup MUST require typed confirmation bound to registry ID and current digest.

#### Scenario: Negative input - traversal path
- **WHEN** an export or cleanup target escapes a registered raw-data root or crosses a reparse point
- **THEN** the operation MUST fail before reading, moving, or deleting data

#### Scenario: State or race - cleanup crash
- **WHEN** the service crashes after quarantine but before final deletion
- **THEN** restart recovery MUST use the journal to restore or safely resume exactly once

#### Scenario: Boundary or null - empty selection
- **WHEN** export or cleanup receives no explicit profile IDs
- **THEN** it MUST reject the request and MUST NOT interpret it as all profiles

#### Scenario: Auth or permission - cross-tenant cleanup
- **WHEN** a valid user requests cleanup of data outside its tenant or lacks cleanup scope
- **THEN** the request MUST be denied, redacted, and audited without revealing the path
