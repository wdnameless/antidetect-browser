# disposable-profiles Specification

## Purpose
Defines ephemeral profile lifecycle management, isolated directory allocation, automatic cleanup upon termination or crash, startup orphan purges, and strict isolation from persistent data and preserved backups.

## Requirements

### Requirement: Ephemeral profile creation and registry
The system MUST provide an endpoint `POST /profiles/temporary` that creates an ephemeral profile descriptor without writing rows into permanent profile database tables.

#### Scenario: Successful temporary profile creation
- **GIVEN** an active launcher API service
- **WHEN** a client sends `POST /profiles/temporary` with valid configuration
- **THEN** the system MUST return a temporary profile object with a unique UUID and `temporary: true`
- **AND** the profile MUST be registered in the in-memory lifecycle registry

#### Scenario: Temporary profiles excluded from default listings
- **GIVEN** three persistent profiles and two active temporary profiles
- **WHEN** a client requests `GET /profiles` without temporary flags
- **THEN** the response MUST list exactly the three persistent profiles

### Requirement: Isolated filesystem allocation
Temporary profiles MUST allocate their `user-data-dir` strictly inside a dedicated `.temporary_profiles/` directory hierarchy isolated from persistent user data and preserved archives.

#### Scenario: Strict path containment
- **GIVEN** a temporary profile launch request
- **WHEN** the user data directory is created
- **THEN** the directory path MUST resolve within `<userDataRoot>/.temporary_profiles/<uuid>`
- **AND** MUST NOT overlap with persistent profile directories or `preserved_browser_data`

### Requirement: Multi-signal automatic cleanup
The system MUST automatically and completely remove the temporary user data directory when the browser session terminates normally, is stopped via API, or when the launcher shuts down.

#### Scenario: Normal browser exit triggers directory removal
- **GIVEN** a running temporary profile browser instance
- **WHEN** the browser window is closed by user or script
- **THEN** the browser process MUST terminate
- **AND** the temporary `user-data-dir` folder MUST be deleted from disk within 3 seconds

#### Scenario: Launcher shutdown terminates and cleans temporary profiles
- **GIVEN** active temporary profile browser instances
- **WHEN** the launcher process receives `SIGTERM` or `SIGINT`
- **THEN** all temporary browser processes MUST be killed
- **AND** their temporary directories MUST be scheduled for immediate deletion

### Requirement: Startup orphan purge sweep
Upon launcher initialization, the system MUST scan the temporary directory root and remove orphaned directories from prior abnormal terminations or crashes.

#### Scenario: Sweep cleans orphaned crash directories
- **GIVEN** leftover temporary directories from a previous system crash
- **WHEN** the launcher service starts up
- **THEN** the startup sweep MUST discover all orphaned temporary directories
- **AND** MUST safely delete them while leaving all persistent profile folders untouched
