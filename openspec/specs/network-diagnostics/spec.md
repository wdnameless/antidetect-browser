# network-diagnostics Specification

## Purpose
TBD - created by archiving change add-quick-wins-pack. Update Purpose after archive.

## Requirements

### Requirement: Diagnostics for a running profile

The system SHALL provide authenticated, authorized diagnostics for a running profile and MUST return per-check `pass|fail|unknown` plus evidence timestamp/policy ID. External IP/geolocation MUST use the configured browser egress; timezone, WebRTC, DNS, UA/platform, and consistency checks MUST NOT convert unavailable or inconclusive evidence into pass. A stopped profile remains `NOT_RUNNING`. Probe results MUST bind to the same profile lifecycle revision so stop/restart races cannot return stale success.

#### Scenario: Negative input - malformed profile ID
- **WHEN** a malformed or nonexistent ID is requested
- **THEN** validation/not-found behavior MUST occur without starting a browser or probe

#### Scenario: State or race - profile stops during probe
- **WHEN** lifecycle revision changes during diagnostics
- **THEN** the result MUST be discarded as stale and returned non-pass

#### Scenario: Boundary or null - unavailable DNS comparison
- **WHEN** reliable resolver comparison is unavailable
- **THEN** `dns_leak` MUST be `unknown` with reason and MUST NOT count as release pass

#### Scenario: Auth or permission - cross-tenant diagnostics
- **WHEN** a caller lacks diagnostics permission or profile ownership
- **THEN** access MUST be denied before browser/network details are disclosed

#### Scenario: Running Chromium evidence
- **WHEN** an authorized caller checks a running Chromium profile under a pinned policy
- **THEN** the response MUST include policy ID, timestamp, tri-state results, and evidence references

#### Scenario: Diagnostics on a running profile
- **WHEN** an authorized user requests diagnostics for a running profile
- **THEN** IP/geo, timezone, WebRTC, DNS, and consistency results MUST use the profile egress and report tri-state evidence

#### Scenario: Diagnostics on a closed profile
- **WHEN** diagnostics are requested for a stopped profile
- **THEN** `NOT_RUNNING` MUST be returned and no browser MUST be started

#### Scenario: DNS-leak hint is honest
- **WHEN** reliable resolver comparison cannot be performed
- **THEN** DNS status MUST be `unknown`, not pass

### Requirement: Diagnostics UI

The renderer SHALL show pass, fail, unknown, stale, and not-running states distinctly and MUST display evidence timestamp/policy ID without presenting unknown as green.

#### Scenario: Unknown result display
- **WHEN** any required probe is unknown or stale
- **THEN** the UI MUST show a non-green blocking state and reason

#### Scenario: Unauthorized UI access
- **WHEN** the operator lacks diagnostics permission
- **THEN** the action MUST be hidden or disabled and direct API denial MUST remain authoritative

#### Scenario: Operator runs a check
- **WHEN** an authorized operator runs diagnostics for a running profile
- **THEN** cards MUST update with tri-state results, policy ID, and evidence timestamp

#### Scenario: Not-running state
- **WHEN** the operator opens diagnostics for a stopped profile
- **THEN** the UI MUST require starting the profile and MUST NOT show stale data
