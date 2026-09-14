## Purpose

Defines installer-free distribution on every platform, acquisition and verification of the browser kernel at run time, and a data location that makes a portable copy genuinely portable.

## ADDED Requirements

### Requirement: No installer
The product MUST be distributable as a file the user runs directly. An installer artefact MUST NOT be produced.

#### Scenario: The executable runs without installing
- **GIVEN** the Windows artefact and a machine that has never had the product
- **WHEN** the user runs the file
- **THEN** the product MUST start
- **AND** nothing MUST have been installed

#### Scenario: No installer is shipped
- **WHEN** the release artefacts are inspected
- **THEN** no installer artefact MUST be present

### Requirement: Each platform ships in its native single-file form
Windows and Linux MUST ship as a single file. macOS MUST ship in the form the platform actually allows, and the limitation MUST be stated rather than hidden.

#### Scenario: Windows is one file
- **WHEN** the Windows artefact is inspected
- **THEN** it MUST be a single executable

#### Scenario: Linux is one file
- **WHEN** the Linux artefact is inspected
- **THEN** it MUST be a single self-contained executable image

#### Scenario: The macOS limitation is disclosed
- **WHEN** the macOS artefact is published
- **THEN** the documentation MUST state that it is not a single file and what the user must do to open it
- **AND** MUST NOT claim single-file behaviour the platform does not provide

### Requirement: The kernel is acquired at run time, not bundled
The browser kernel MUST NOT be bundled into the distribution artefact. It MUST be acquired on first use and verified before it is used.

#### Scenario: First run acquires the kernel
- **GIVEN** an installation with no kernel present
- **WHEN** the product starts
- **THEN** it MUST acquire the kernel, reporting progress
- **AND** MUST only use it after verification succeeds

#### Scenario: The artefact does not carry the kernel
- **WHEN** a release artefact is inspected
- **THEN** the kernel MUST NOT be inside it

#### Scenario: Absence of network is reported
- **GIVEN** no network access and no kernel present
- **WHEN** the product starts
- **THEN** it MUST report that the kernel cannot be acquired
- **AND** MUST NOT start a browser with a missing or partial kernel

### Requirement: An acquired kernel is verified before use
The downloaded kernel MUST be checked against a digest pinned in our source. A mismatch MUST fail closed.

#### Scenario: Correct payload is accepted
- **WHEN** the download matches the pinned digest
- **THEN** it MUST be accepted and made available for use

#### Scenario: Tampered payload is refused
- **GIVEN** a payload whose bytes differ from the pinned digest
- **WHEN** verification runs
- **THEN** it MUST be refused with a clear error
- **AND** MUST NOT be made available for use
- **AND** MUST NOT be left in place looking usable

#### Scenario: Truncated download is refused
- **GIVEN** a download interrupted part-way
- **WHEN** verification runs
- **THEN** it MUST be refused
- **AND** a retry MUST be possible without a manual cleanup step

### Requirement: Data location is chosen for portability
A portable launch MUST let the operator keep data beside the executable so the whole installation can be moved as one folder, and the choice MUST be remembered.

#### Scenario: Portable layout is offered
- **GIVEN** a first portable launch with no recorded choice
- **WHEN** the product starts
- **THEN** it MUST offer to keep data beside the executable
- **AND** MUST remember the answer

#### Scenario: Moving the folder keeps the data
- **GIVEN** a portable installation keeping data beside the executable
- **WHEN** the whole folder is moved to a different path
- **THEN** the existing profiles and settings MUST remain reachable
- **AND** no new empty store MUST be created

#### Scenario: A normal installation is not asked
- **GIVEN** an ordinary non-portable launch
- **WHEN** the product starts
- **THEN** it MUST NOT prompt for a data location

### Requirement: Existing credentials keep working
Portable distribution MUST NOT change how secrets are stored, so credentials created before it remain readable.

#### Scenario: Existing secrets are readable
- **GIVEN** a credential stored before this change
- **WHEN** the product reads it after this change
- **THEN** it MUST decrypt successfully
- **AND** the storage mechanism MUST have kept its identity

### Requirement: A portable copy can move machines
The portable form MUST remain functional when copied to another machine of the same platform.

#### Scenario: Copied installation works
- **GIVEN** a portable installation on one machine
- **WHEN** its folder is copied to another machine of the same platform
- **THEN** the product MUST start and its profiles MUST be reachable
- **AND** the kernel MUST be re-acquired only if it is absent
