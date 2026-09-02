## MODIFIED Requirements

### Requirement: Sync session lifecycle

The system SHALL preserve the sync-session model while requiring every member to be a running Chromium profile. Stopped Chromium uses existing `NOT_RUNNING`; Firefox/Camoufox refusal status, headers, content type, envelope, and application code MUST be whatever the isolated signed V1/V2 corpus pins and MUST NOT be invented. Validation and creation MUST commit atomically. Authentication/authorization precedence MUST remain corpus-compatible.

#### Scenario: Create from running Chromium profiles
- **WHEN** an authorized user posts two or more running Chromium profile IDs
- **THEN** an active session is atomically created with the first as master

#### Scenario: Negative input - removed engine member
- **WHEN** any posted ID belongs to Firefox/Camoufox
- **THEN** the corpus-pinned refusal MUST be returned and no session/listener row MUST be created

#### Scenario: State or race - member stops during creation
- **WHEN** a member stops or is disabled during session validation
- **THEN** creation MUST roll back with `NOT_RUNNING` or the corpus-pinned removed-engine refusal and attach no listener

#### Scenario: Boundary or null - empty member list
- **WHEN** `profile_ids` is null, empty, duplicated, or contains fewer than two distinct IDs
- **THEN** validation MUST fail without creating a session

#### Scenario: Auth or permission - unauthorized sync
- **WHEN** a caller lacks sync permission
- **THEN** authorization MUST fail before profile engine/state details are disclosed

#### Scenario: Stop a session
- **WHEN** an authorized user stops a session
- **THEN** all CDP bindings/listeners are detached, slaves are cleared, and status becomes `stopped`

#### Scenario: Create a session from running Chromium profiles
- **WHEN** an authorized user posts two or more distinct running Chromium profile IDs
- **THEN** the first becomes master and the remaining profiles become slaves in one active session

#### Scenario: Not-running profile is rejected
- **WHEN** any Chromium profile is not running
- **THEN** `NOT_RUNNING` MUST be returned and no session MUST be created

#### Scenario: Firefox profile is rejected
- **WHEN** any profile belongs to Firefox/Camoufox
- **THEN** the corpus-pinned refusal MUST be returned and no session MUST be created
