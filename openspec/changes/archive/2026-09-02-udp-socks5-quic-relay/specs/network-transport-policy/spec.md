## ADDED Requirements

### Requirement: UDP-over-SOCKS5 relay
The system SHALL relay UDP datagrams through the profile's SOCKS5 proxy using UDP ASSOCIATE (RFC 1928) so that QUIC/HTTP3 and WebRTC UDP traffic egress from the proxy exit IP. The relay MUST support username/password authentication and MUST encapsulate datagrams with the SOCKS5 UDP header.

#### Scenario: QUIC over relayed UDP
- **WHEN** a profile with a UDP-capable SOCKS5 proxy loads an HTTP/3-only endpoint
- **THEN** the endpoint observes the proxy exit IP and the host egress IP never appears in packet capture

#### Scenario: WebRTC over relayed UDP
- **WHEN** a WebRTC ICE check runs in a relayed profile
- **THEN** all gathered candidates resolve to the proxy exit IP and no host or local interface candidate is exposed

### Requirement: Fail-closed QUIC fallback
When the assigned proxy lacks UDP ASSOCIATE support, the system MUST launch the profile with QUIC/HTTP3 disabled and MUST NOT allow direct host UDP egress for proxied traffic.

#### Scenario: TCP-only proxy
- **WHEN** a profile uses a SOCKS5 proxy that refuses UDP ASSOCIATE
- **THEN** the browser is launched with QUIC disabled and the profile start response reports state `quic-disabled`

#### Scenario: HTTP proxy without UDP
- **WHEN** a profile uses an HTTP/HTTPS proxy
- **THEN** QUIC is disabled and no UDP relay is attempted

### Requirement: UDP capability probing
The system SHALL probe each SOCKS5 proxy for UDP support using a STUN binding request over the relay and SHALL cache the result with a reason code for diagnostics and policy decisions.

#### Scenario: Probe result cache
- **WHEN** a proxy is probed twice within the cache TTL
- **THEN** the second probe reuses the cached verdict and reason code without new network traffic

#### Scenario: Probe failure reason codes
- **WHEN** a probe fails
- **THEN** the result carries a machine-readable reason (`udp-associate-refused`, `stun-timeout`, `auth-failed`, `network-unreachable`)
