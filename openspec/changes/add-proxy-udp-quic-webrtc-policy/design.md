# Design: Proxy UDP, QUIC & WebRTC Transport Policy

## Context and Scope

To protect user identities, anti-detect browser instances using proxy servers must never leak direct origin IP addresses through WebRTC ICE discovery or QUIC/HTTP3 fallback paths. This design implements strict pre-flight validation, deterministic Chromium flag injection, fail-closed runtime monitoring, and UDP SOCKS5 encapsulation.

## Key Decisions

1. **Pre-flight Probe Pipeline**: Before spawning Chromium, the proxy subsystem executes a sequential or concurrent probe validating TCP connectivity, SOCKS5/HTTP credentials, DNS resolution through the proxy, UDP ASSOCIATE support, STUN binding (RFC 5389) over IPv4/IPv6, and QUIC handshakes.
2. **Fail-Closed Fallback Policy**: If a proxy fails any UDP probe (e.g. standard HTTP/HTTPS proxy or restrictive SOCKS5 server without UDP support), Chromium is launched with `--disable-quic` and WebRTC ICE gathering restricted to proxy-relay only.
3. **Zero Direct Network Fallback**: If the proxy connection terminates during an active browsing session, the browser process is killed immediately via SIGTERM/SIGKILL to prevent transparent direct traffic leaks.
4. **HMAC-Keyed Probe Caching**: Probes are cached in memory for up to 10 minutes (600s). The cache key is computed using an HMAC of the proxy host, port, and credential digest to prevent storing raw secrets in memory. Host network changes invalidate all cache entries.
5. **UDP-over-SOCKS5 Relay Service**: Implements RFC 1928 UDP packet framing and handling, routing local UDP datagrams through the negotiated proxy association port.

## Migration and Compatibility

- Backward compatible with existing proxy database records.
- Seamlessly falls back to TCP-only browsing without QUIC when UDP is unavailable, maintaining complete leak protection.
