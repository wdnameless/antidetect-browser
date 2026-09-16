## ADDED Requirements

### Requirement: The shell runs the backend, not the desktop entry

The shell MUST launch the Node backend service and MUST NOT launch the previous desktop entry point.

#### Scenario: The service entry is spawned
- **WHEN** the shell starts the backend
- **THEN** the spawned entry MUST be the service entry (`dist/src/main/index.js`)
- **AND** the desktop entry (`dist/electron/main.js`) MUST NOT be spawned

#### Scenario: The backend needs no desktop runtime
- **GIVEN** a bundled Node runtime
- **WHEN** the backend is spawned
- **THEN** it MUST start without any desktop-runtime module being resolvable
- **AND** a failure to resolve one MUST NOT be a startup path

### Requirement: Readiness is observed from the real output

The shell MUST wait for the readiness line the backend actually emits.

#### Scenario: The emitted line is awaited
- **GIVEN** the backend printing `[antidetect] Local API listening on http://<host>:<port>`
- **WHEN** the shell is waiting for readiness
- **THEN** that line MUST be sufficient to declare readiness
- **AND** the shell MUST NOT wait for a line the backend does not print

#### Scenario: A bound port also counts
- **GIVEN** a backend that bound its port without its output being captured
- **WHEN** the port accepts a connection
- **THEN** readiness MUST be declared
- **AND** a fixed delay MUST NOT be used as a substitute

#### Scenario: Readiness is not assumed from process creation
- **WHEN** the child process has been created but has not signalled readiness
- **THEN** the shell MUST NOT present the interface as ready

### Requirement: Failure to start is legible

A backend that fails MUST produce an explanation rather than an empty window.

#### Scenario: Early exit is reported
- **GIVEN** a backend that exits before signalling readiness
- **WHEN** the shell opens
- **THEN** the window MUST state that the backend failed and include the exit code
- **AND** it MUST NOT point the webview at an unbound port

#### Scenario: Timeout is reported
- **GIVEN** a backend that neither signals readiness nor exits
- **WHEN** the readiness timeout elapses
- **THEN** the window MUST state that startup timed out

### Requirement: The backend does not outlive the shell

Teardown MUST run on every exit route.

#### Scenario: Normal close
- **WHEN** the window is closed and the application exits
- **THEN** the backend process MUST be terminated
- **AND** its port MUST be released

#### Scenario: Forced termination
- **WHEN** the shell is terminated without a clean shutdown
- **THEN** the backend MUST NOT be left running

### Requirement: The native bridge is provided by the shell

The shell MUST expose the same native bridge namespace the renderer already consumes, so the renderer is not modified.

#### Scenario: The namespace keeps its shape
- **WHEN** the served interface runs inside the shell
- **THEN** `window.antidetect` MUST expose `getApiKey`, `data.{getDir,setDir,prepareDir,migrateDir,setDirPath,openDir}`, `logs.openDir`, `update.{check,download,quitAndInstall,onStatus}` and `window.{minimize,toggleMaximize,close}`
- **AND** each MUST keep the signature the renderer calls it with

#### Scenario: The renderer is not forked
- **WHEN** the bridge is added
- **THEN** the renderer source MUST NOT be edited to accommodate it
- **AND** a browser client without the bridge MUST keep working

#### Scenario: Window controls drive the real window
- **WHEN** the bridge's window controls are called
- **THEN** the shell window MUST minimize, toggle between maximized and restored, and close respectively

### Requirement: Native dialogs and file manager actions

Folder selection and file-manager opening MUST be provided by the shell.

#### Scenario: Choosing a data folder
- **WHEN** the renderer asks for a new data folder
- **THEN** the operating system's folder chooser MUST open
- **AND** a cancelled chooser MUST report failure without changing the stored folder

#### Scenario: Opening a folder
- **WHEN** the renderer asks to open the data or log folder
- **THEN** the operating system's file manager MUST open at that folder

### Requirement: A single instance owns the service

Only one shell instance MUST run against the data directory.

#### Scenario: A second launch focuses the first
- **WHEN** a second instance starts while one is running
- **THEN** the second MUST exit
- **AND** the running instance's window MUST be brought to the foreground

### Requirement: The tray mirrors the previous behaviour

The tray MUST exist and closing the window MUST hide rather than destroy it while the tray exists.

#### Scenario: Close hides to the tray
- **GIVEN** a tray that was created successfully
- **WHEN** the window is closed
- **THEN** the window MUST hide and the application MUST keep running

#### Scenario: No tray, no stranding
- **GIVEN** a tray that could not be created
- **WHEN** the window is closed
- **THEN** the application MUST exit
- **AND** it MUST NOT remain running with no way to be reached

#### Scenario: Quit from the tray exits fully
- **WHEN** the tray's quit item is chosen
- **THEN** the application MUST exit and teardown MUST run
