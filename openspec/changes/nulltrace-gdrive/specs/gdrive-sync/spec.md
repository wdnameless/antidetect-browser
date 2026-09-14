## ADDED Requirements

### Requirement: The operator's own OAuth client
Authentication MUST use an OAuth client the operator supplies. The product MUST NOT ship, embed, or operate an OAuth client of its own.

#### Scenario: No client of ours exists
- **WHEN** the repository and the shipped build are inspected
- **THEN** no OAuth client id or secret belonging to the product MUST be present

#### Scenario: The operator configures a client
- **GIVEN** an installation with no Drive configuration
- **WHEN** the operator supplies a client id
- **THEN** it MUST be accepted and stored securely
- **AND** Drive sync MUST become available

#### Scenario: Missing configuration is inert
- **GIVEN** no client id configured
- **WHEN** the application runs
- **THEN** no Drive request MUST be made

### Requirement: Credentials are never exposed
A client secret and a refresh token MUST be stored in the secret store and MUST NOT appear in any log, response, diagnostic output, or sync payload.

#### Scenario: Token is stored securely
- **WHEN** authentication completes
- **THEN** the refresh token MUST be persisted through the secret store
- **AND** MUST NOT be written to the settings file

#### Scenario: Token is redacted
- **WHEN** a diagnostic, log line, or API response is produced while authenticated
- **THEN** it MUST NOT contain the refresh token or the client secret

#### Scenario: Disconnecting removes access
- **WHEN** the operator disconnects
- **THEN** the stored token MUST be cleared
- **AND** no further upload MUST occur

### Requirement: Drive holds a usable copy of the operator's data
Profiles, scripts and settings MUST be pushable to a folder in the operator's Drive and retrievable on another machine.

#### Scenario: Round trip
- **GIVEN** a connected Drive with data pushed from one machine
- **WHEN** another machine connects to the same account
- **THEN** it MUST find the existing folder rather than creating a new one
- **AND** it MUST be able to retrieve what was pushed

#### Scenario: Settings travel too
- **WHEN** settings are pushed
- **THEN** a retrieval on another machine MUST yield those settings

### Requirement: A pull never silently destroys local data
Retrieving remote state MUST NOT overwrite local data without an explicit rule or an operator decision.

#### Scenario: Conflict is surfaced
- **GIVEN** a local profile and a different remote profile with the same identity
- **WHEN** a pull runs
- **THEN** the difference MUST be reported
- **AND** the local copy MUST NOT be replaced without an explicit choice

#### Scenario: Unchanged data is left alone
- **WHEN** a pull finds nothing newer than local state
- **THEN** no local data MUST be modified

### Requirement: The existing sync path is unaffected
The self-hosted sync MUST remain available and unchanged, and the operator MUST be able to tell which path is configured.

#### Scenario: Both paths coexist
- **GIVEN** the self-hosted sync configured
- **WHEN** Drive is also configured
- **THEN** both MUST remain selectable
- **AND** the interface MUST make clear which one is in use

#### Scenario: Drive is additive
- **WHEN** Drive support ships
- **THEN** the self-hosted push and pull behaviour MUST be unchanged

### Requirement: Failure is legible
A failed or expired authorisation MUST produce something the operator can act on, and MUST NOT stall silently.

#### Scenario: Expired grant
- **GIVEN** a revoked or expired authorisation
- **WHEN** a sync is attempted
- **THEN** the failure MUST be reported as an authorisation problem requiring the operator to reconnect
- **AND** it MUST NOT present as an unexplained hang or a generic error

#### Scenario: Missing scope
- **GIVEN** a client without the required Drive scope
- **WHEN** the operator connects
- **THEN** the insufficiency MUST be reported as such
