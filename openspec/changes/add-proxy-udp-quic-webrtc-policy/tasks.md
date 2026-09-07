## 1. Network Transport Probes & Validation

- [x] 1.1 Implement pre-launch proxy probe pipeline (TCP connect, Auth, DNS, SOCKS5 UDP ASSOCIATE, STUN, QUIC handshake).
- [x] 1.2 Implement HMAC-keyed in-memory probe result cache with 10m TTL and OS network interface change invalidation.
- [x] 1.3 Add unit and integration tests for proxy probe pipeline and single-flight deduplication.

## 2. Fail-Closed Flag Enforcement & Direct Leak Protection

- [x] 2.1 Wire Chromium launcher flags to inject `--disable-quic` and strict WebRTC proxy relay binding when UDP is unsupported.
- [x] 2.2 Add runtime proxy drop monitor that terminates browser processes immediately on connection failure.
- [x] 2.3 Verify zero direct network fallback guarantees via network isolation and fault injection tests.

## 3. UDP-over-SOCKS5 Relay Integration

- [x] 3.1 Implement RFC 1928 SOCKS5 UDP encapsulation client for WebRTC and QUIC datagrams.
- [x] 3.2 Test full end-to-end packet egress to verify traffic originates strictly from proxy exit IPs.
