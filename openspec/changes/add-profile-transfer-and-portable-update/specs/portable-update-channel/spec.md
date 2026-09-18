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

### Requirement: The portable swap waits for the running application to exit
The portable launcher is not resident — it extracts the shell, starts it, and exits — so its
file is already writable while the application runs. The swap MUST therefore wait for the
running application process itself to exit before replacing the launcher, and MUST NOT start
the replacement while the previous process may still hold the backend port or the instance
lock.

#### Scenario: The swap does not start a second instance
- **GIVEN** a running portable build whose launcher file is not locked
- **WHEN** the update is applied
- **THEN** the launcher MUST NOT be replaced, and no new instance MUST be started, until the
  running application process has exited

### Requirement: A failed swap is reported and changes nothing
If the running application does not exit within the deadline, or the launcher cannot be
replaced, the swap MUST leave the launcher unchanged, MUST leave the staged artefact in place
for a later attempt, MUST record the failure where an operator can find it, and MUST NOT start
any process — so that a failed update cannot appear to have succeeded by relaunching the old
version.

#### Scenario: A locked launcher leaves the running build untouched
- **GIVEN** a staged portable artefact and a launcher that cannot be replaced
- **WHEN** the swap gives up
- **THEN** the launcher MUST be unchanged, the staged artefact MUST remain, a failure record
  MUST be written, and no process MUST be started

### Requirement: The update flow can be completed from the control that reports it
Where the interface reports that an update is available, that same control MUST be able to
carry the update to completion — download, install and relaunch — without requiring the
operator to find a separate screen. The flow MUST NOT start without an operator action.

#### Scenario: Acting on the reported update finishes the update
- **GIVEN** a build reporting that an update is available
- **WHEN** the operator activates that control once
- **THEN** the update MUST proceed through download and install to a running new version

#### Scenario: Progress is visible where the update was announced
- **GIVEN** an update that has begun downloading
- **WHEN** the download reports progress
- **THEN** the progress MUST be shown by the same control that announced the update
