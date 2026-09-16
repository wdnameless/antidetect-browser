## MODIFIED Requirements

### Requirement: Windows single-file portable artefact

The Windows desktop distribution MUST include a single-file portable artefact that requires no installation and keeps self-contained data.

#### Scenario: One file, no installation
- **WHEN** the operator runs the portable artefact
- **THEN** no installation MUST occur
- **AND** the application MUST start from that single file

#### Scenario: Data stays relocatable
- **GIVEN** the portable artefact launched from a directory
- **WHEN** the data location is resolved
- **THEN** it MUST resolve relative to the directory the operator ran the file from
- **AND** moving that directory MUST move the data with it

#### Scenario: An explicit choice is honoured
- **GIVEN** the operator has chosen the system data location
- **WHEN** the portable artefact resolves its data directory
- **THEN** the system location MUST win over the beside-the-executable default

### Requirement: The runtime is bundled

The distribution MUST carry the runtime the backend needs.

#### Scenario: No prerequisite runtime
- **WHEN** the operator runs any desktop artefact
- **THEN** the backend MUST start without the operator having installed a runtime separately
- **AND** a missing system runtime MUST NOT be a supported configuration

#### Scenario: The runtime is packaged as a declared sidecar
- **WHEN** the distribution is assembled
- **THEN** the runtime MUST be declared as a bundled sidecar binary
- **AND** it MUST be resolvable at runtime relative to the installed application

### Requirement: Installer and portable artefacts remain distinguishable

Both artefacts MUST be published with names that identify them.

#### Scenario: Distinct names
- **WHEN** artefacts are produced
- **THEN** the installer and the portable file MUST have distinct, self-describing names
- **AND** neither MUST overwrite the other in the release directory

### Requirement: The artefact carries no browser kernel

The fingerprint browser kernel MUST NOT be baked into the artefact.

#### Scenario: Kernel is fetched, not embedded
- **WHEN** a desktop artefact is built
- **THEN** the browser kernel MUST NOT be included in it
- **AND** the kernel MUST be obtained at first run as it is today

#### Scenario: A bundled kernel path is still honoured where one exists
- **GIVEN** an installation that does ship a kernel directory
- **WHEN** the kernel executable is resolved
- **THEN** that directory MUST be searched
- **AND** the data-directory kernel MUST remain a fallback
