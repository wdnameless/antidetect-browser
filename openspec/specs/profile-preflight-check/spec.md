# profile-preflight-check Specification

## Purpose
TBD - created by archiving change profile-preflight-check. Update Purpose after archive.

## Requirements

### Requirement: Preflight consistency verdict
The system SHALL provide a preflight check per profile covering proxy liveness, egress IP geolocation vs fingerprint locale/timezone, WebRTC candidate hygiene, DNS egress path, and QUIC relay state, returning a machine-readable verdict with stable reason codes.

#### Scenario: Consistent profile passes
- **WHEN** a profile whose proxy geo, timezone and language agree is preflighted
- **THEN** the overall verdict is `pass` with every check enumerated

#### Scenario: Timezone drift fails
- **WHEN** the proxy egress country implies a timezone different from the profile fingerprint timezone
- **THEN** the `timezone-match` check is `fail` with reason `tz-proxy-mismatch` and the overall verdict is `fail`

### Requirement: Launch guard
Profile start SHALL accept an optional `blockOnFail` flag; when set and the preflight verdict is `fail`, the system MUST refuse to launch and MUST return the verdict payload.

#### Scenario: Blocked launch
- **WHEN** start is requested with `blockOnFail` and any fail-severity check trips
- **THEN** the browser does not start and the API responds with the full verdict

### Requirement: Graceful degradation
When the UDP relay change is absent, the QUIC relay check MUST report `warn` with reason `relay-unavailable` instead of failing.

#### Scenario: Relay absent
- **WHEN** preflight runs on a build without UDP relay support
- **THEN** the `quic-relay-state` check reports `warn/relay-unavailable` and does not fail the verdict
