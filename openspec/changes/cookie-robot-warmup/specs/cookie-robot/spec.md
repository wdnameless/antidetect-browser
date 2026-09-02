## ADDED Requirements

### Requirement: Automated warm-up sessions
The system SHALL provide a Cookie Robot that browses a supplied URL list within a profile using human-like pacing (randomized dwell, scrolling, mouse movement), accumulating cookies, history and localStorage through the profile's own proxy and fingerprint.

#### Scenario: Warm-up run
- **WHEN** the robot runs with 20 URLs on a profile
- **THEN** the profile accumulates cookies/history from visited domains and a run report records pagesVisited, cookiesSet and durationMs

#### Scenario: Pacing bounds
- **WHEN** dwell range is 2000-8000 ms
- **THEN** every per-page dwell in the run log falls within the configured range

### Requirement: Session safety policy
The robot MUST enforce maxPages, dwell range, session duration cap and per-domain rate limits, MUST NOT fill or submit forms, and MUST halt within one page-load when the kill switch is triggered.

#### Scenario: Kill switch
- **WHEN** the kill switch triggers mid-run
- **THEN** the robot stops before starting another page load and the report marks the run `aborted`

#### Scenario: Form safety
- **WHEN** a visited page contains a login form
- **THEN** the robot performs no input into form fields
