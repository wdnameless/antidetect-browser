## Purpose

Defines ephemeral profile lifecycle management, isolated directory allocation, automatic cleanup upon termination or crash, startup orphan purges, and strict isolation from persistent data and preserved backups.

## ADDED Requirements

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
The system MUST guarantee complete disk deletion of a temporary profile's `user-data-dir` upon browser window close, stop API call, or application shutdown.

#### Scenario: Window close triggers full directory removal
- **GIVEN** a running temporary profile browser instance
- **WHEN** the browser window is closed by the user or automation script
- **THEN** the process exit listener MUST trigger asynchronous recursive removal of `<userDataRoot>/.temporary_profiles/<uuid>`
- **AND** unregister the profile from the in-memory registry

#### Scenario: Graceful stop via API endpoint
- **GIVEN** an active temporary profile
- **WHEN** `POST /profiles/:id/stop` is received
- **THEN** the browser process MUST terminate cleanly
- **AND** its associated temporary folder MUST be deleted within 5 seconds

### Requirement: Startup orphan directory purge
Upon application startup, the launcher MUST scan `.temporary_profiles/` and safely remove all orphaned directories remaining from previous ungraceful exits or power cuts.

#### Scenario: Orphan directories purged on launch
- **GIVEN** leftover folders inside `.temporary_profiles/` from an unexpected host reboot
- **WHEN** the launcher initializes during startup
- **THEN** it MUST enumerate all subdirectories in `.temporary_profiles/`
- **AND** MUST safely delete them while leaving all persistent profile folders untouched
