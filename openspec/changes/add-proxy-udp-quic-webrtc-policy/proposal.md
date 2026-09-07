## Why

The proxy layer requires robust UDP, QUIC, and WebRTC network transport enforcement. To prevent IP leaks and guarantee fail-closed security, all outbound UDP datagrams must be relayed via SOCKS5 UDP ASSOCIATE or strictly blocked. WebRTC ICE candidate gathering must be bound exclusively to proxy endpoints, and QUIC/HTTP3 handshakes must fail closed when proxy UDP capabilities are missing.

## What Changes

- Pre-launch transport verification: probe TCP, Auth, DNS, UDP ASSOCIATE, STUN IPv4/IPv6, and QUIC handshakes before profile launch.
- Fail-closed WebRTC and QUIC enforcement: inject Chromium flags `--disable-quic` and force-bind WebRTC relay when UDP/STUN/QUIC capabilities are unconfirmed.
- Zero direct fallback guarantee: immediate browser process termination if the proxy tunnel drops mid-session.
- Credential-safe single-flight probe caching: in-memory cache keyed via HMAC (TTL 10m) with network interface change invalidation.
- Transparent SOCKS5 UDP relay: encapsulation of UDP packets for QUIC and WebRTC with RFC 1928 header framing.

## Capabilities

### New Capabilities
- `network-transport-policy`: Pre-launch verification, fail-closed QUIC/WebRTC enforcement, UDP-over-SOCKS5 relay, and zero direct fallback.

### Modified Capabilities
None.

## Impact

- `src/main/proxy/`: network probe service, SOCKS5 UDP relay implementation, and probe caching.
- `src/main/launcher/`: Chromium launch flag injection for WebRTC policy and QUIC fallback.
