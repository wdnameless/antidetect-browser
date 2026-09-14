## Purpose

Program-level contracts for closing the verified feature gaps against ProxyShard/ShardX and Afina.io. This umbrella owns governance, wave ordering, and the "defect before feature" rule. Per-child capability deltas live in their own changes.

## ADDED Requirements

### Requirement: Verified defect closure precedes new capability work

A gap may be called a *defect* only when the repository proves the capability is declared but unbacked. Every defect identified in the 2026-09-13 gap analysis MUST be closed before any new-capability child in the same batch begins, and closing it MUST remove either the declaration or the stub — not rename it.

The three defects at program start are: `StealthOptions.fontList` declared and consumed nowhere; the `module` flow node compiling to a fabricated success object; `src/main/telegram/bot.ts` implemented and imported by no file.

#### Scenario: A defect is closed by deletion or by implementation
- **WHEN** a defect child completes
- **THEN** the repository MUST either consume the declared field or drop the declaration
- **AND** MUST NOT leave a differently-named equivalent alongside it

#### Scenario: Stub detection at gate time
- **WHEN** a flow compiles a `module` node
- **THEN** the compiled program MUST invoke the script engine and MUST NOT synthesise a success result

#### Scenario: Dead code is detected by the suite
- **WHEN** `src/main/telegram/bot.ts` exports a class that no module imports
- **THEN** the program's hygiene check MUST report it and the child MUST wire or delete it

### Requirement: Font enumeration reflects the claimed device

A profile MUST present the font set of the device it claims. A page enumerating fonts through any supported surface MUST NOT observe the host machine's font inventory, and declared families the host lacks MUST still measure as present.

#### Scenario: Host font is hidden
- **GIVEN** a macOS-claiming profile on a Windows host
- **WHEN** a page probes for `Segoe UI`
- **THEN** the probe MUST NOT report the host's font as present

#### Scenario: Declared font measures as present
- **GIVEN** a profile declaring a font the host does not have
- **WHEN** a page measures that font
- **THEN** it MUST measure as available, rendered through a substituted face

#### Scenario: Non-mobile and mobile profiles differ
- **WHEN** a phone-claiming profile and a desktop-claiming profile are compared
- **THEN** their observable font inventories MUST be the phone's and the desktop's respectively

### Requirement: Mobile profiles expose coherent motion sensors

A profile claiming a phone MUST expose accelerometer, gyroscope, and orientation surfaces consistent with a handset being handled; a profile claiming a desktop MUST leave those surfaces at host behaviour.

#### Scenario: Phone profile reports a held device
- **WHEN** a page subscribes to `devicemotion` on a phone-claiming profile
- **THEN** it MUST receive readings consistent with a handheld device and MUST NOT receive the host's absent-sensor state

#### Scenario: Desktop profile is untouched
- **WHEN** a page probes sensor surfaces on a desktop-claiming profile
- **THEN** the observed behaviour MUST equal stock browser behaviour on that host

#### Scenario: Consistency with the declared device
- **GIVEN** a phone-claiming profile
- **WHEN** sensor readings and the profile's claimed orientation are compared
- **THEN** they MUST agree

### Requirement: Every automation surface performs real work

No node, tool or command in the automation surface may report success for an operation it did not perform. A surface that cannot execute MUST fail with a typed error.

#### Scenario: Module node executes
- **GIVEN** a flow containing a `module` node
- **WHEN** the flow runs
- **THEN** the referenced module MUST actually be invoked with the node's arguments
- **AND** a failure inside the module MUST propagate as a task error, not a success

#### Scenario: No silent success
- **WHEN** a module identifier cannot be resolved
- **THEN** the run MUST fail with a typed error naming the identifier

### Requirement: Operator control works without the desktop UI

An operator MUST be able to start, stop, and inspect profile runs, and receive completion notifications, without opening the desktop application.

#### Scenario: Remote command
- **GIVEN** a configured bot token and an allowlisted chat
- **WHEN** the operator sends a start or status command
- **THEN** the action MUST execute against local profiles and the reply MUST report the resulting state

#### Scenario: Unlisted chat is refused
- **WHEN** a chat not on the allowlist sends a command
- **THEN** the command MUST NOT execute and the attempt MUST be recorded

### Requirement: Data interchange with real operator formats

Profiles and proxies MUST import and export through the formats operators actually hold: Chromium cookie databases and Excel workbooks.

#### Scenario: Cookie database roundtrip
- **GIVEN** a Chromium profile with cookies
- **WHEN** its Cookies SQLite database is imported and then exported
- **THEN** the cookie set MUST match on name, host, path and value

#### Scenario: Live profile is protected
- **WHEN** a write targets a running profile's cookie database
- **THEN** the write MUST be refused rather than risk corrupting the store

#### Scenario: Workbook roundtrip
- **WHEN** profiles and proxies are exported to a workbook and re-imported
- **THEN** the imported rows MUST match the source on every written column

### Requirement: Standalone automation without the desktop application

Engine control MUST be available as a library: a client MUST be able to obtain the engine, launch an isolated profile, and receive a CDP endpoint without the desktop UI running. This program delivers Node, Python and Rust clients; the scope is profile control and the CDP endpoint, not a bundled stealth driver or a Rust release guarantee.

#### Scenario: Library launch returns a usable endpoint
- **GIVEN** a machine with no desktop application installed
- **WHEN** a client creates and launches a profile
- **THEN** it MUST receive a CDP endpoint that an independent CDP client can connect to

#### Scenario: Isolation is preserved
- **WHEN** two profiles are launched by a library client
- **THEN** their user-data directories and fingerprints MUST be distinct

#### Scenario: Engine delivery is idempotent
- **WHEN** the engine has already been fetched
- **THEN** a later client run MUST NOT re-download it

### Requirement: Multi-device and multi-platform reach

Profiles and settings MUST be synchronizable through the operator's own Google Drive account, and the product MUST run on macOS arm64 as a signed, notarized application.

#### Scenario: Drive sync with the operator's own client
- **GIVEN** a user-supplied OAuth client identifier
- **WHEN** the operator enables Drive sync
- **THEN** profiles and settings MUST upload and later restore from that account
- **AND** the product MUST NOT ship or embed its own OAuth client

#### Scenario: macOS build is accepted by the OS
- **GIVEN** a macOS arm64 build
- **WHEN** a user opens it on a machine that has never seen it
- **THEN** it MUST launch without a quarantine workaround

### Requirement: Wave ordering is honored

Work MUST proceed in the recorded order: defects and data formats first, then automation, then SDKs, then Drive sync, then macOS. A wave MUST NOT start while a prior wave has an unresolved defect from the closure requirement.

#### Scenario: Out-of-order start is refused
- **WHEN** an automation child would begin while a batch-1 defect remains open
- **THEN** the program MUST block it and report the open defect

#### Scenario: Platform work is last
- **WHEN** the macOS child is proposed for an earlier wave
- **THEN** the program MUST defer it, because its engine-availability risk is highest and least resolved
