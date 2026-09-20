## ADDED Requirements

### Requirement: One folder holds everything

The application SHALL keep its settings, database, profiles, extensions, logs and audit records
inside a single directory, so that directory can be copied to removable media and opened on
another machine with the profiles and sessions intact. When the executable runs from a portable
location, that directory SHALL be the folder beside the executable.

#### Scenario: Launch from a portable folder

- **WHEN** the application starts with its executable in a directory that is not under a system
  application path
- **THEN** its settings file, API key, database, profile workspaces, extension store, logs and MCP
  audit log all resolve inside that directory
- **AND** no settings file is written under the user's roaming application data

#### Scenario: The folder is moved to another machine

- **WHEN** the directory is copied to a machine where the previously recorded location does not
  exist
- **THEN** the application uses the folder beside the executable
- **AND** the profiles and their sessions are the ones in that folder

#### Scenario: A recorded location still exists

- **WHEN** the directory records a location that exists on this machine
- **THEN** that location is used, so an installation keeps its existing data

### Requirement: No stray directories elsewhere

A normal run SHALL NOT create directories outside its own folder. A directory created under the
user profile for the interface's own cache counts as a stray directory.

#### Scenario: First run on a clean machine

- **WHEN** the application starts on a machine that has never run it
- **THEN** the only directories it creates are inside its own folder

## MODIFIED Requirements

### Requirement: The profiles table shows what the operator acts on

The profiles table SHALL show the profile name, its proxy, its running status and its actions.
It MUST NOT render the device/OS, fingerprint or preflight columns.

#### Scenario: The table renders

- **WHEN** the profiles page is displayed
- **THEN** its header has no `Device / OS`, `Fingerprint` or `Preflight` cell
- **AND** the actions column remains reachable at every window width

### Requirement: Profile import and export live with the data folder

Import CSV, Export CSV and Import Bundle SHALL be offered in Settings alongside the data-folder
controls. The profiles toolbar MUST NOT contain them.

#### Scenario: Finding the actions

- **WHEN** the operator opens Settings → Data Folder
- **THEN** all three actions are present and each performs its action

### Requirement: The breadcrumb names the navigation group

The breadcrumb SHALL name the sidebar group that contains the current page, not a fixed word.

#### Scenario: A page in the Library group

- **WHEN** the Devices or Extensions page is displayed
- **THEN** the breadcrumb reads `Library / <page>`

#### Scenario: A page in the System group

- **WHEN** the Settings page is displayed
- **THEN** the breadcrumb reads `System / Settings`

### Requirement: MCP is available without being asked for

The MCP server SHALL start when the application starts, so that an agent configured against it
finds it running. Manual control remains available.

#### Scenario: A normal start

- **WHEN** the application has started
- **THEN** the MCP server reports itself running without any operator action

#### Scenario: A failure to start is visible

- **WHEN** the MCP server cannot start automatically
- **THEN** the reason is stated rather than the panel silently reading "Off"

### Requirement: The MCP panel carries only working controls

The panel SHALL NOT offer a control that copies the MCP client configuration. Its Documentation
control SHALL open the project's documentation in the system browser.

#### Scenario: Documentation is opened

- **WHEN** the operator presses Documentation
- **THEN** a GitHub URL opens in the system browser, outside the application window

### Requirement: The version line matches the interface

The version and update control in the sidebar SHALL use the application's design tokens and show
its progress visibly. It SHALL honour a reduced-motion preference.

#### Scenario: An update check runs

- **WHEN** the operator starts an update check
- **THEN** the control shows a visible progress state rather than a static label

#### Scenario: Reduced motion is requested

- **WHEN** the system asks for reduced motion
- **THEN** the control changes state without animation
