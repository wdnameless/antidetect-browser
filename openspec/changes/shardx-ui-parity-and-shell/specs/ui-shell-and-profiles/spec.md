## ADDED Requirements

### Requirement: The sidebar collapses and expands

The navigation sidebar MUST be collapsible and expandable, the state MUST survive a restart,
and the control MUST be visible to an operator who has not read any documentation.

The reference product has no collapse at all, so this is the app's own behaviour and MUST
survive the visual port unchanged.

#### Scenario: The control is discoverable
- **WHEN** the operator looks at the sidebar
- **THEN** a control that collapses it MUST be visible without hovering or reading documentation
- **AND** it MUST remain reachable while the sidebar is collapsed, so the state can be undone

#### Scenario: The state persists
- **GIVEN** the sidebar is collapsed
- **WHEN** the application is restarted
- **THEN** it MUST still be collapsed

#### Scenario: The collapsed rail stays legible
- **WHEN** the sidebar is collapsed
- **THEN** every destination MUST remain reachable
- **AND** no text or control MAY overflow the rail

### Requirement: The footer shows the running version

The sidebar footer MUST display the version of the application that is actually running.

#### Scenario: The version is a real number
- **WHEN** the application is running
- **THEN** the footer MUST show a concrete version string
- **AND** it MUST NOT fall back to a bare product name when the backend cannot resolve one

#### Scenario: The backend is the authority, the build is the fallback
- **GIVEN** the backend answers a version
- **WHEN** the footer renders
- **THEN** that value MUST be shown
- **AND** when the backend answers `unknown`, the version compiled into the interface MUST be shown instead

### Requirement: One control transfers every discovered profile set into the folder in use

After a scan for existing data folders, a single control MUST transfer profiles from every
discovered folder into the folder currently in use, without switching the working folder.

#### Scenario: All folders are handled in one action
- **GIVEN** a completed scan that found one or more folders
- **WHEN** the operator activates the transfer-all control
- **THEN** profiles MUST be transferred from every discovered folder into the folder in use
- **AND** the result MUST report how many were created and how many were already present

#### Scenario: A failure in one folder does not stop the others
- **GIVEN** several discovered folders and one that cannot be read
- **WHEN** the transfer-all control runs
- **THEN** the remaining folders MUST still be transferred
- **AND** the failure MUST be reported rather than swallowed

#### Scenario: The existing per-folder control is preserved
- **WHEN** the transfer-all control exists
- **THEN** each discovered folder MUST still offer its own transfer control

#### Scenario: The control is absent when there is nothing to transfer
- **WHEN** the scan found no folders, or none contains profiles
- **THEN** the transfer-all control MUST NOT be offered

### Requirement: The interface matches the reference product's layout

The application's shell and Profiles page MUST follow the reference product's layout and visual
system — geometry, surface treatment, navigation grouping, page structure — while keeping the
application's own colours and fonts.

#### Scenario: Shell anatomy
- **WHEN** the application renders
- **THEN** the sidebar MUST be 240px wide, rising to 280px on very wide viewports
- **AND** navigation MUST be grouped under uppercase section labels
- **AND** the content area MUST use 28px horizontal and 24px vertical padding

#### Scenario: The page is named inside the content
- **WHEN** a page renders
- **THEN** its name MUST appear as a breadcrumb inside the content area, beside that page's search
- **AND** the window titlebar MUST carry only the drag region and the window controls

#### Scenario: Content sits on cards
- **WHEN** a content block renders
- **THEN** it MUST sit on a raised surface with the reference's radius and hairline border
- **AND** it MUST NOT read as a flat, borderless region

#### Scenario: The Profiles page follows the reference's order
- **WHEN** the Profiles page renders
- **THEN** it MUST present, in order: the metric cards, the folder tabs with counts, the toolbar
  row, the table
- **AND** an empty library MUST show a designed empty state with its own call to action

#### Scenario: Metrics are real
- **WHEN** the metric cards render
- **THEN** each value MUST come from the backend
- **AND** a value that has not loaded MUST NOT be presented as zero

### Requirement: Status colours carry hue, identity colours do not

Status tokens MUST be distinguishable by hue. The accent, primary controls, active navigation
and all surfaces MUST remain monochrome.

#### Scenario: Statuses are legible at a glance
- **WHEN** a profile is running, or an operation fails
- **THEN** the success and error treatments MUST be distinguishable by hue, not only by brightness

#### Scenario: The identity stays monochrome
- **WHEN** the palette is inspected
- **THEN** the accent, buttons, navigation and surface tokens MUST still carry no perceptible chroma
- **AND** the guard that enforces this MUST continue to cover them
