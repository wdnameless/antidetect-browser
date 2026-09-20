# macOS arm64 portable distribution

## ADDED Requirements

### Requirement: A macOS arm64 artefact is produced on a macOS runner
The product MUST be buildable and publishable for Apple Silicon. The build MUST run on macOS,
because the SDK and the code-signing tools exist only there and Windows cannot cross-compile to it.

#### Scenario: The artefact is produced by CI
- **GIVEN** a tagged release and a `macos-14` (Apple Silicon) runner
- **WHEN** the release job runs
- **THEN** an artefact named `NullTrace-<version>-macos-arm64.zip` MUST be produced
- **AND** it MUST contain `NullTrace.app` built for arm64

#### Scenario: The Windows job is unchanged
- **WHEN** the release runs with the macOS entry added
- **THEN** the existing Windows artefacts MUST keep their names and paths
- **AND** the Windows-only updater-manifest step MUST NOT be attempted on macOS

### Requirement: The portable form is a folder the operator can move
On macOS the artefact MUST be a folder containing `NullTrace.app` and its data beside it, so the
whole thing can be copied to another path or machine and reopened with the same profiles. The
platform does not allow a single-file executable, and that limitation MUST be stated rather than
hidden.

#### Scenario: The folder moves and keeps its data
- **GIVEN** a portable layout with profiles
- **WHEN** the entire folder is moved to a different path on the same Mac
- **THEN** the application MUST open with the same profiles
- **AND** MUST NOT create a second, empty data directory

#### Scenario: The single-file limitation is disclosed
- **WHEN** the macOS artefact is documented
- **THEN** the documentation MUST state that the form is a folder, not one file
- **AND** MUST NOT claim single-file behaviour the platform does not provide

### Requirement: Nothing is ever written inside the application bundle
The bundle's signature covers its contents. Writing inside it invalidates the signature, and macOS
then refuses to launch the bundle. All mutable state MUST live outside it.

#### Scenario: The bundle stays pristine
- **GIVEN** a full run that creates profiles, acquires the kernel and writes settings
- **WHEN** `codesign --verify --deep --strict` is run on the bundle afterwards
- **THEN** it MUST exit successfully
- **AND** no runtime artefact (webview cache, logs, database, api key) MUST exist inside the bundle

#### Scenario: A read-only bundle still works
- **GIVEN** a bundle the operator cannot write to
- **WHEN** the application starts
- **THEN** it MUST start and place all mutable state outside the bundle
- **AND** MUST NOT fail with an opaque permission error

### Requirement: The browser kernel is acquired and verified on macOS
Kernel acquisition MUST work on macOS exactly as it does on Windows: download, verify the pinned
SHA-256, extract, and report the result. The pinned macOS asset currently exists in the source but
its extraction branch throws, so the platform it was pinned for has never run.

#### Scenario: A clean install acquires the kernel
- **GIVEN** no kernel present
- **WHEN** the operator requests it
- **THEN** the image MUST be downloaded and verified against the pinned digest
- **AND** the executable inside it MUST be located and made usable
- **AND** the mounted image MUST be detached afterwards, including when extraction fails

#### Scenario: A tampered payload is still refused
- **GIVEN** a payload whose bytes differ from the pinned digest
- **WHEN** verification runs
- **THEN** it MUST be refused with a clear error
- **AND** MUST NOT be extracted, and MUST NOT be left in place looking usable

#### Scenario: A stale mount does not break the mount point
- **GIVEN** an image already mounted at the conventional path
- **WHEN** a second mount occurs
- **THEN** the actual mount point MUST be resolved from the tool's own output
- **AND** extraction MUST use that path, not an assumed one

### Requirement: The kernel's architecture and stealth are measured, not assumed
Whether the kernel runs natively on arm64 or only under translation, and whether its stealth holds
there, MUST be established by measurement on the target hardware and stated in the documentation
with the measurement behind it.

#### Scenario: The architecture is reported
- **WHEN** the kernel is inspected on Apple Silicon
- **THEN** the report MUST include the architectures in its executable
- **AND** whether the launched process runs translated or natively

#### Scenario: Stealth is verified under CDP
- **GIVEN** the kernel launched with a debugging endpoint attached
- **WHEN** the page surface is read
- **THEN** `navigator.webdriver` MUST be false
- **AND** two different fingerprint seeds MUST produce different visible surfaces

#### Scenario: A negative result is disclosed rather than hidden
- **GIVEN** the kernel cannot run natively on arm64
- **WHEN** the macOS build is documented
- **THEN** the documentation MUST state the requirement it places on the operator
- **AND** MUST NOT describe the build as fully functional on that platform

### Requirement: Platform-specific gaps are stated, not silently absent
Features implemented only for Windows MUST be identified on macOS rather than appearing present but
doing nothing.

#### Scenario: The Windows-only features are listed
- **WHEN** the macOS platform limitations are documented
- **THEN** the capture-protection auto-lock and session-lock MUST be named as unavailable
- **AND** the UI MUST NOT present a control that has no effect there

#### Scenario: An orphaned backend is addressed
- **GIVEN** the shell is killed without running its teardown on macOS
- **WHEN** the application is started again
- **THEN** it MUST NOT be left unable to bind its port because a previous backend survived
- **AND** the mechanism it relies on instead MUST be documented
