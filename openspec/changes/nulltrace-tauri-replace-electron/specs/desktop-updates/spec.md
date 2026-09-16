## ADDED Requirements

### Requirement: Updates are discovered through the platform updater

The shell MUST use the platform updater to discover and download updates.

#### Scenario: Update check
- **WHEN** the renderer requests an update check
- **THEN** the shell MUST query the configured update endpoint
- **AND** the result MUST be reported to the renderer through the existing status channel

#### Scenario: Progress is reported
- **GIVEN** an update being downloaded
- **WHEN** download progress is reported by the platform updater
- **THEN** the shell MUST forward the progress to the renderer

### Requirement: Independent verification precedes installation

An artefact MUST be verified against the signed manifest before it is installed.

#### Scenario: Verification happens on the artefact
- **GIVEN** a downloaded update artefact
- **WHEN** installation is requested
- **THEN** the artefact MUST be checked against the signed manifest and trusted keyring **before** installation
- **AND** installation MUST be refused when verification fails

#### Scenario: Bytes are available to the verifier
- **WHEN** the verification runs
- **THEN** it MUST receive the artefact itself, not a path it cannot obtain
- **AND** verification MUST NOT be skipped because the artefact is not reachable from the renderer

#### Scenario: Refusal is auditable
- **WHEN** verification refuses an update
- **THEN** the refusal and its reason MUST be logged
- **AND** the currently installed version MUST remain untouched

### Requirement: The keyring is present and trusted

Verification MUST NOT fail merely because the trusted keyring is missing.

#### Scenario: A shipped keyring exists
- **WHEN** a release artefact is built
- **THEN** the trusted keyring MUST be shipped with it
- **AND** the keyring path MUST be resolvable at runtime

#### Scenario: An empty keyring is a refusal, not a pass
- **GIVEN** a keyring with no trusted keys
- **WHEN** verification runs
- **THEN** the update MUST be refused
- **AND** the refusal MUST be reported rather than silently treated as success

### Requirement: Rollback protection is preserved

A manifest whose version is not newer than the installed version MUST be refused.

#### Scenario: Older version is refused
- **GIVEN** an installed version and a signed manifest naming an equal or older version
- **WHEN** verification runs
- **THEN** the update MUST be refused as a rollback

### Requirement: The single-file artefact can update itself

The portable single-file distribution MUST be able to replace itself.

#### Scenario: Self-update completes
- **GIVEN** a running portable artefact and a newer verified release
- **WHEN** the operator applies the update
- **THEN** the artefact MUST be replaced by the newer verified build
- **AND** the operator MUST be told a restart is required when the running file cannot be replaced in place

#### Scenario: Self-update failure is reported
- **GIVEN** a self-update whose download or verification fails
- **WHEN** the failure occurs
- **THEN** the running artefact MUST remain intact and runnable
- **AND** the failure MUST be reported rather than silently ignored

### Requirement: The update manifest matches the platform consumer

The published update metadata MUST be the format the platform updater reads.

#### Scenario: Manifest is published
- **WHEN** a release is produced
- **THEN** the update metadata MUST be published in the format the platform updater consumes
- **AND** the artefact's signature MUST be published alongside it
