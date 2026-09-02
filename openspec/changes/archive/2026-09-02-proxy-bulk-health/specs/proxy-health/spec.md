## ADDED Requirements

### Requirement: Bulk health checks
The system SHALL check an entire proxy pool (or filtered subset) concurrently with a bounded in-flight limit, reporting per proxy: latency, exit IP, geo, UDP capability when determinable, status, and a stable machine-readable reason code.

#### Scenario: 500-proxy sweep
- **WHEN** check-all runs over 500 proxies
- **THEN** every proxy receives a verdict and the in-flight concurrency never exceeds the configured bound

#### Scenario: Failure classification
- **WHEN** a proxy refuses authentication
- **THEN** its report carries status `fail` with reasonCode `auth-failed`

### Requirement: Anti-drift usage cache
The system SHALL record which proxy each profile last used with resolved country and timestamp, and SHALL warn when a candidate attachment would change the profile's country.

#### Scenario: Drift warning
- **WHEN** a profile last used a DE-exit proxy and is now assigned a US-exit proxy
- **THEN** the attach flow surfaces a `country-drift` warning naming both countries

#### Scenario: Consistent reattach
- **WHEN** a profile is re-attached to its last used proxy
- **THEN** no drift warning is raised and the usage record refreshes its timestamp
