# portable-update-channel Specification

## Purpose
Defines which release artefact an in-app update downloads, given that the same application
ships as an installer and as a self-contained portable launcher, and that the two must not
be substituted for one another.

## ADDED Requirements

### Requirement: The update channel follows how the build was launched
The release metadata MUST offer a distinct artefact for the portable build, and an update
check MUST select the entry matching how the running build was launched: a build carrying
`PORTABLE_EXECUTABLE_DIR` MUST resolve the portable entry, and a build without it MUST
resolve the installer entry.

#### Scenario: Portable build resolves the portable entry
- **GIVEN** release metadata offering `windows-x86_64` (installer) and `windows-x86_64-portable`
- **WHEN** a build launched with `PORTABLE_EXECUTABLE_DIR` set checks for an update
- **THEN** the resolved download MUST be the portable artefact

#### Scenario: Installed build resolves the installer entry
- **GIVEN** the same metadata and a build launched without `PORTABLE_EXECUTABLE_DIR`
- **WHEN** it checks for an update
- **THEN** the resolved download MUST be the installer artefact

### Requirement: Portable metadata is published only with the portable artefact
The release process MUST publish the portable entry only when a portable artefact was actually
built and signed, and MUST publish the installer entry only alongside the installer. Metadata
MUST NOT describe an artefact that does not exist at the referenced URL.

#### Scenario: A missing portable artefact omits the entry
- **GIVEN** a release run where the portable artefact was not produced
- **WHEN** the metadata is generated
- **THEN** the portable entry MUST be absent, and the installer entry MUST still be present

### Requirement: An update never replaces a binary with the wrong kind of artefact
Applying an update to a portable build MUST write a portable artefact over the portable
launcher, and MUST NOT write an installer in its place.

#### Scenario: Portable self-update swaps in a portable launcher
- **GIVEN** a running portable build and a verified portable artefact
- **WHEN** the update is applied
- **THEN** the launcher file MUST be replaced by that artefact, and the application MUST
  restart as the new version
