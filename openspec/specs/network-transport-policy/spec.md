# network-transport-policy Specification

## Purpose
Defines pre-launch proxy transport validation, deterministic WebRTC and QUIC flag enforcement, single-flight probe caching, credential protection, and mid-session termination rules to prevent direct origin IP leaks.

## Requirements

### Requirement: Pre-launch proxy transport verification
Before launching any browser profile configured with a proxy, the system MUST execute deterministic transport probes verifying TCP reachability, authentication, proxy DNS resolution, SOCKS5 UDP_ASSOCIATE, STUN reachability (IPv4 and IPv6), and QUIC handshakes.

#### Scenario: SOCKS5 full pass allows proxy-bound WebRTC and QUIC
- **GIVEN** a valid SOCKS5 proxy configuration
- **WHEN** pre-launch probes confirm TCP, Auth, DNS, UDP_ASSOCIATE, STUN IPv4/IPv6, and QUIC success
- **THEN** browser launch MUST succeed with WebRTC bound exclusively to the proxy relay and QUIC enabled

#### Scenario: Auth or TCP failure refuses launch
- **GIVEN** an unreachable proxy host or invalid proxy credentials
- **WHEN** pre-launch TCP connect or authentication probe fails after 1 retry
- **THEN** browser launch MUST be refused and no browser process SHALL be spawned

### Requirement: Fail-closed WebRTC and QUIC enforcement
When a proxy transport is constrained (HTTP/HTTPS/SSH proxies or SOCKS5 with failed UDP/STUN/QUIC), the system MUST inject fail-closed Chromium flags blocking WebRTC and disabling QUIC.

#### Scenario: SOCKS5 UDP failure blocks WebRTC
- **GIVEN** a SOCKS5 proxy where TCP succeeds but UDP_ASSOCIATE or STUN probe fails
- **WHEN** the browser profile is launched
- **THEN** launch MUST succeed in constrained mode with WebRTC completely blocked and QUIC disabled

#### Scenario: HTTP proxy disables WebRTC and QUIC
- **GIVEN** an HTTP or HTTPS proxy configuration
- **WHEN** the browser profile is launched
- **THEN** launch MUST inject `--disable-quic` and restrict WebRTC to prevent direct IP discovery

### Requirement: Zero direct fallback guarantee
Under no circumstances SHALL a browser profile configured with a proxy fall back to direct host network interfaces or bypass the proxy tunnel.

#### Scenario: Proxy drop triggers immediate termination
- **GIVEN** an active running browser session using a proxied connection
- **WHEN** the proxy tunnel drops or authentication is revoked mid-session
- **THEN** the system MUST immediately terminate the browser process and MUST NOT permit un-proxied direct traffic

### Requirement: Credential-safe single-flight probe caching
Probe results MUST be cached in memory for a maximum TTL of 10 minutes (600 seconds), deduplicating concurrent requests via single-flight execution, and keyed via HMAC without storing or hashing raw passwords.

#### Scenario: Concurrent launch requests deduplicate probes
- **GIVEN** multiple profiles starting simultaneously with identical proxy endpoints
- **WHEN** pre-launch verification begins
- **THEN** exactly one network probe SHALL be dispatched and all callers MUST share the single-flight outcome

#### Scenario: Interface change invalidates cache
- **GIVEN** a valid cached probe entry
- **WHEN** host network interface or default gateway change is detected
- **THEN** the cache entry MUST be invalidated immediately and active proxied browsers MUST be checked
