## ADDED Requirements

### Requirement: The shell is thin
The desktop shell MUST present the existing served interface and MUST NOT contain a second implementation of the interface or the backend.

#### Scenario: One interface
- **WHEN** the shell is opened
- **THEN** it MUST display the interface served by the backend
- **AND** it MUST NOT bundle a separate copy of the renderer

#### Scenario: One backend
- **WHEN** the shell runs
- **THEN** it MUST use the existing backend
- **AND** it MUST NOT reimplement the application's behaviour in the shell

#### Scenario: Same product identity
- **WHEN** the shell is installed alongside the existing desktop build
- **THEN** both MUST be recognisable as the same product
- **AND** an existing installation MUST NOT be orphaned

### Requirement: The backend is started and awaited
The shell MUST start the backend and wait until it is actually ready before showing the interface.

#### Scenario: Readiness is observed
- **GIVEN** the shell starting
- **WHEN** the backend has not yet signalled readiness
- **THEN** the shell MUST wait for that signal
- **AND** MUST NOT rely on a fixed delay

#### Scenario: Failure is legible
- **GIVEN** a backend that fails to start
- **WHEN** the shell opens
- **THEN** it MUST explain the failure
- **AND** MUST NOT present a blank window pointed at nothing

### Requirement: The backend is terminated with the shell
The backend MUST NOT outlive the shell on any exit path.

#### Scenario: Normal close
- **WHEN** the shell is closed normally
- **THEN** the backend process MUST be terminated
- **AND** its port MUST be released

#### Scenario: Every exit route
- **WHEN** the shell exits by any route — window close, application quit, or termination
- **THEN** teardown MUST run
- **AND** no backend process MUST be left behind

### Requirement: Installation is not claimed to be removed
Documentation and packaging MUST state that the desktop shell is an installed application, and that the served web interface is what requires no installation.

#### Scenario: Documentation is honest
- **WHEN** the shell is documented
- **THEN** it MUST state that it is installed like any desktop application
- **AND** MUST point to the web interface as the install-free option

#### Scenario: macOS limitation is stated
- **WHEN** the macOS shell is described
- **THEN** the documentation MUST state that it is unsigned and what the operator must do to open it
- **AND** MUST NOT imply that signing exists

### Requirement: The existing desktop build is not displaced prematurely
The existing desktop build MUST remain available until the shell is proven on every platform it targets.

#### Scenario: Both are published
- **WHEN** release artefacts are produced
- **THEN** the existing desktop build MUST still be published
- **AND** the shell MUST be additive

#### Scenario: The shell does not gate the release
- **GIVEN** an unproven shell
- **WHEN** a release runs
- **THEN** a failure in the shell build MUST NOT block the existing artefacts
