## 1. Core probe engine

- [ ] 1.1 Implement TCP connect and proxy authentication verification in `src/main/proxy/proxyManager.ts` with 5s timeout and 1 jittered retry.
- [ ] 1.2 Implement SOCKS5 proxy-DNS, `UDP_ASSOCIATE`, and STUN (IPv4/IPv6) probe routines in `src/main/proxy/socks5Server.ts`.
- [ ] 1.3 Implement QUIC handshake validation probe over the verified proxy relay.

## 2. Caching and deduplication

- [ ] 2.1 Implement single-flight probe coordinator preventing duplicate concurrent network probes for identical targets.
- [ ] 2.2 Implement 10-minute in-memory probe cache using HMAC-SHA256 key derivation excluding raw passwords/tokens.
- [ ] 2.3 Implement cache invalidation listener for network interface changes and proxy configuration updates.

## 3. Launcher policy enforcement

- [ ] 3.1 Map probe outcomes to Table 6.1 launch actions in `src/main/launcher/chromium.ts` (`NO_PROXY`, `SOCKS5_FULL_PASS`, `CONSTRAINED`, `REFUSE`).
- [ ] 3.2 Inject fail-closed Chromium flags (`--disable-quic`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, `--disable-webrtc`).
- [ ] 3.3 Implement mid-session transport monitor terminating active proxied browser instances on TCP, DNS, UDP, or QUIC failure.

## 4. Verification and validation

- [ ] 4.1 Write Vitest unit test suite covering all 18 states in Table 6.1 matrix in `tests/unit/network-transport-policy.test.ts`.
- [ ] 4.2 Write integration test verifying zero direct packet leakage and single-flight cache deduplication.
- [ ] 4.3 Run `openspec validate add-proxy-udp-quic-webrtc-policy --strict` and confirm zero validation errors.
