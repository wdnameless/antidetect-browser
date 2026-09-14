## Purpose

Defines running one flow across many profiles at once and observing each browser's progress independently.

## ADDED Requirements

### Requirement: A flow runs across multiple profiles
The operator MUST be able to choose more than one profile for a run and a concurrency limit, and the run MUST dispatch to each chosen profile.

#### Scenario: Multi-profile dispatch
- **GIVEN** a flow and three selected profiles
- **WHEN** the run starts
- **THEN** a task MUST exist for each selected profile
- **AND** the number executing at once MUST NOT exceed the chosen concurrency

#### Scenario: Single profile still works
- **WHEN** the operator runs with one profile selected
- **THEN** the run MUST behave as it does today

### Requirement: Per-profile progress is observable
The view MUST show, for every profile in the run, the step it is on and its state, distinguishing queued, working and finished.

#### Scenario: Current step per profile
- **GIVEN** a run in progress
- **WHEN** one profile has completed two of five nodes
- **THEN** its row MUST show that progress and its current node

#### Scenario: Queued is distinct from working
- **GIVEN** a run with five profiles and a concurrency of two
- **WHEN** the run is in progress
- **THEN** profiles beyond the concurrency limit MUST be shown as queued, not working

### Requirement: Failures are per profile
One profile's failure MUST NOT terminate or mask the others.

#### Scenario: One fails, others continue
- **GIVEN** a run of three profiles
- **WHEN** one profile's task errors
- **THEN** that profile MUST be marked failed
- **AND** the other two MUST continue and report their own outcome

### Requirement: Per-profile logs remain reachable
The operator MUST be able to read the log of any single profile in the run.

#### Scenario: Select a profile's log
- **WHEN** the operator selects a fleet row
- **THEN** that profile's own log MUST be shown
- **AND** it MUST NOT be interleaved with another profile's lines

### Requirement: A run can be stopped
The operator MUST be able to stop a running run, and queued profiles MUST NOT start after the stop.

#### Scenario: Stop mid-run
- **GIVEN** a run with two working and three queued profiles
- **WHEN** the operator stops it
- **THEN** working profiles MUST be terminated and queued ones MUST NOT start
