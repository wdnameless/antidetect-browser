## ADDED Requirements

### Requirement: Self-hostable sync server
The system SHALL provide a server implementing the existing sync client wire protocol for encrypted bundle push/pull with per-workspace isolation, so teams can run sync without an external service.

#### Scenario: Protocol round-trip
- **WHEN** a stock syncClient pushes then pulls a bundle against the server
- **THEN** the pulled bundle is byte-identical to the pushed ciphertext and requires no client change

#### Scenario: Workspace isolation
- **WHEN** a client presents credentials for workspace A but requests a bundle from workspace B
- **THEN** the request is denied with `workspace-forbidden`

### Requirement: Workspace roles
The server SHALL enforce owner/editor/viewer roles: viewers pull only, editors push and pull, owners additionally manage membership; unauthenticated or under-privileged calls MUST be denied by default.

#### Scenario: Viewer cannot push
- **WHEN** a viewer-role token attempts a bundle push
- **THEN** the server rejects with `role-denied` and logs the attempt

### Requirement: Sync audit log
The server SHALL record every sync operation (actor, action, bundle id, timestamp) in a queryable audit log.

#### Scenario: Audit completeness
- **WHEN** a push, a pull and a denied push occur
- **THEN** the audit log contains all three with correct outcomes
