## ADDED Requirements

### Requirement: Signed runtime manifests
Runtime releases SHALL ship a JCS-canonicalized Ed25519-signed manifest covering every delivered artifact digest; the launcher MUST verify signature and monotonic version before applying an update and MUST fail closed on mismatch.

#### Scenario: Tampered artifact rejected
- **WHEN** any byte of a delivered artifact differs from its manifest digest
- **THEN** verification fails and the update is not applied

#### Scenario: Rollback rejected
- **WHEN** a manifest presents a version lower than the currently installed one
- **THEN** the update is refused as an anti-rollback violation

### Requirement: Script and extension signature enforcement
The script engine and extension loader MUST verify an Ed25519 signature over an md5 manifest of every file before execution and MUST refuse unsigned or altered payloads in production mode.

#### Scenario: One-byte change blocks execution
- **WHEN** a signed module file is modified by one byte after signing
- **THEN** the executor refuses to run it and writes an audit log entry

#### Scenario: Dev override is explicit
- **WHEN** a developer passes `--allow-unsigned-dev` in a non-production build
- **THEN** unsigned modules run with a loud warning; production builds ignore the flag

### Requirement: Key-ring governance
The system SHALL support key rotation, revocation and recovery with an offline verification path; revoked keys MUST fail verification immediately.

#### Scenario: Revoked key
- **WHEN** a manifest signed by a revoked key is presented
- **THEN** verification fails with reason `key-revoked`
