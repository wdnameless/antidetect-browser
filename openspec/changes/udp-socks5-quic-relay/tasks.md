## 1. UDP relay core

- [x] 1.1 Implement `src/main/proxy/udpRelay.ts`: SOCKS5 UDP ASSOCIATE handshake, datagram encapsulation per RFC 1928, auth (user/pass + IP whitelist), idle timeout and teardown.
- [x] 1.2 Add per-proxy UDP-capability probe (STUN binding request over the relay) with cached result and reason codes.
- [x] 1.3 Unit tests: handshake success/failure, malformed datagrams, auth failure, timeout teardown, probe caching.

## 2. Policy integration

- [x] 2.1 Extend `transportPolicy.ts`: compose Chromium flags so QUIC/HTTP3 routes via relay when UDP-capable; force `--disable-quic` when not.
- [x] 2.2 Wire WebRTC UDP through the same relay path; verify no host-interface binding remains.
- [x] 2.3 Surface relay state (relay | quic-disabled | direct-forbidden) in profile start API response and diagnostics endpoint.
- [x] 2.4 Unit + integration tests for flag composition matrix: udp-capable socks5, tcp-only socks5, http proxy, no proxy.

## 3. Evidence and gate

- [x] 3.1 Add automated leak regression: HTTP/3-only endpoint + WebRTC check must never observe host egress IP for relayed profiles.
- [x] 3.2 Record dated evidence artifact under `evidence/`; update `network-transport-policy` spec sync.
