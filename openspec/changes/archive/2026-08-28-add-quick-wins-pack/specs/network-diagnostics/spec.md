# network-diagnostics delta

## ADDED Requirements

### Requirement: Diagnostics for a running profile

The system SHALL provide `GET /api/v1/diagnostics/:profileId` that, only while the profile's browser is running, collects via CDP: external IP + geo (through the browser proxy), browser timezone vs IP timezone match, WebRTC leak probe (JS `RTCPeerConnection` evaluated in the MAIN world), and user-agent/platform consistency. For a non-running profile the endpoint SHALL answer `code:"NOT_RUNNING"`.

#### Scenario: Diagnostics on a running profile

- **WHEN** the user requests diagnostics while the profile browser is running
- **THEN** the response contains `ip`, `geo`, `timezone` (browser value), `ip_timezone`, `timezone_match: ok|warn`, `webrtc: ok|warn` with leaked addresses when present, and `consistency: ok|warn`
- **AND** the collection is performed through the profile's own proxy so the IP reflects the real egress

#### Scenario: Diagnostics on a closed profile

- **WHEN** the user requests diagnostics for a profile that is not running
- **THEN** the response is `code:"NOT_RUNNING"` and no browser is started

#### Scenario: DNS-leak hint is honest

- **WHEN** a reliable two-resolver IP comparison cannot be performed from the browser context
- **THEN** `dns_leak` is returned as `null` (unknown) rather than a fabricated ok/warn value

### Requirement: Diagnostics UI

The renderer SHALL show a Diagnostics page/modal with cards for IP/geo, Timezone match, WebRTC leak, and Consistency, colored green for `ok` and yellow/amber for `warn`, with an explicit "profile is not running" state when the check is unavailable.

#### Scenario: Operator runs a check

- **WHEN** the operator opens Diagnostics for a running profile and clicks Run
- **THEN** the cards update with the collected values and status colors

#### Scenario: Not-running state

- **WHEN** the operator opens Diagnostics for a stopped profile
- **THEN** the UI shows that the profile must be started first instead of showing stale data