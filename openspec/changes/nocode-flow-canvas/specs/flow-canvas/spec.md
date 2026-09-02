## ADDED Requirements

### Requirement: Versioned flow document format
The system SHALL define a JSON flow format with typed nodes (navigate, click, type, wait, condition, loop, extract, screenshot, eval, module call) and branch edges, validated by schema with explicit version field; invalid flows MUST be rejected with named violations.

#### Scenario: Invalid flow rejected
- **WHEN** a flow contains an edge to a nonexistent node
- **THEN** validation fails naming the dangling edge

#### Scenario: Round-trip stability
- **WHEN** a valid flow is exported and re-imported
- **THEN** the document is semantically identical

### Requirement: Deterministic compilation
The compiler SHALL translate a valid flow into a script-engine program deterministically; identical flow input MUST produce identical program output.

#### Scenario: Deterministic output
- **WHEN** the same flow compiles twice
- **THEN** both outputs are byte-identical

### Requirement: Triggered execution via task groups
Flows SHALL execute through task-groups supporting manual and cron triggers, with per-node timing and node-attributed errors in the run log.

#### Scenario: Node-attributed failure
- **WHEN** a click node times out during a run
- **THEN** the task ends `error` and the log identifies the failing node id and selector
