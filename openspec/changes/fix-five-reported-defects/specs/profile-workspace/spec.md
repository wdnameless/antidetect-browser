## ADDED Requirements

### Requirement: The profile table adapts to the window

The profiles table SHALL keep every column readable and every control reachable at any window width. It MUST NOT clip a column because the sum of its widths exceeds the viewport. When the table is wider than its container the container MUST scroll horizontally, and the trailing action column MUST remain reachable.

#### Scenario: Narrow window

- **WHEN** the viewport is 900px wide
- **THEN** the container scrolls horizontally and the action column's right edge is inside the container's visible box
- **AND** every kebab control in that column is clickable

#### Scenario: Wide window

- **WHEN** the viewport is 1400px wide
- **THEN** the table occupies the full container width with no horizontal scrollbar

### Requirement: Transferring profiles carries their metadata

A transfer SHALL reproduce the source profile's stored values, not merely add profiles the destination lacks. When the destination already holds a row with the same profile id, the source's values MUST replace it.

#### Scenario: Stale name in the destination

- **WHEN** the source holds `name = "Source Profile 1"` for id `p1` and the destination holds `name = "STALE NAME"` for `p1`
- **THEN** after the transfer the destination holds `name = "Source Profile 1"`
- **AND** the response reports the row in `updated`, not in `skipped`

#### Scenario: Nothing to change

- **WHEN** the destination already holds exactly the source's values for an id
- **THEN** the row is reported in `skipped` and no write is performed

### Requirement: Transferring profiles carries sessions and dependent records

A transfer SHALL carry the browser state that makes a profile usable, not only its metadata row. Cookies, logins, local storage and the profile's extension bindings MUST arrive with it.

#### Scenario: Sessions arrive

- **WHEN** a profile whose workspace contains cookies and login data is transferred into a folder that lacks it
- **THEN** the destination holds that workspace's cookie and login files, non-empty
- **AND** the transfer reports the workspace as verified, not merely copied

#### Scenario: Extension bindings arrive

- **WHEN** the source has rows in a table keyed by profile id, such as `profile_extensions`
- **THEN** those rows exist in the destination after the transfer

#### Scenario: An existing workspace is not overwritten

- **WHEN** the destination already holds a workspace for a profile id
- **THEN** files the destination already has are left unchanged and only missing files are added

## MODIFIED Requirements

### Requirement: Stealth-extension artifact verification at profile launch

The stealth extension artifact SHALL be verified before a profile launches, failing closed on a tampered payload. The signing key MUST be durable across process restarts so that an artifact this installation signed remains verifiable by this installation.

#### Scenario: Verification across a restart

- **WHEN** an artifact is signed in one process run and verified in a later run of the same installation
- **THEN** verification succeeds

#### Scenario: Tampered artifact rejected

- **WHEN** any byte of the extension's script differs from the signed manifest digest
- **THEN** verification fails with `digest-mismatch` and the launch is aborted

#### Scenario: Rebuild instead of abort

- **WHEN** verification fails but the extension can be regenerated from this installation's own generator
- **THEN** the regeneration is signed and verified, and the launch proceeds
- **AND** the transition is logged

### Requirement: Quitting from the tray closes every open profile

Choosing Quit from the tray SHALL stop every running profile before the application exits, and MUST NOT leave a Chromium process behind.

#### Scenario: Two profiles open

- **WHEN** two profiles are running and the operator chooses Quit
- **THEN** both stop, no Chromium process belonging to them remains, and the application exits

#### Scenario: A profile will not stop

- **WHEN** a profile cannot be stopped within the bounded wait
- **THEN** its process tree is force-killed, the profile id is logged, and the application still exits within the bound
