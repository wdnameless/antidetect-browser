## Context

The antidetect browser provides proxy capabilities (SOCKS5, HTTP, HTTPS, SSH) to isolate profile browsing environments. In multi-tenant and privacy-critical workloads, proxy leaks (specifically WebRTC STUN requests or QUIC fallbacks reaching destination servers over direct host interfaces) represent critical privacy failures.

Dated public ShardBrowser/ShardX repository observations (2026-08) report UDP_ASSOCIATE and STUN probing before profile start. These are design inputs only, not trusted acceptance evidence. This design formalizes the executable network contract specified in `openspec/changes/stealth-parity-hardening/design.md` §6 (Table 6.1).

## Decisions

### 1. Pre-launch deterministic state machine (Table 6.1)
Before launching a Chromium instance with a configured proxy, the launcher executes sequenced diagnostic probes:
1. TCP connect + Auth verification.
2. Proxy-side DNS resolution.
3. SOCKS5 `UDP_ASSOCIATE` command verification.
4. STUN binding requests via the proxy UDP relay (IPv4 and IPv6).
5. QUIC handshake probe via the proxy relay.

Outcomes strictly map to launch policies:
- **NO_PROXY**: Launch allowed; WebRTC direct allowed and labeled; QUIC enabled.
- **SOCKS5 Full Pass (TCP, DNS, UDP_ASSOCIATE, STUN IPv4/IPv6, QUIC)**: Launch allowed; WebRTC proxy-bound only; QUIC enabled.
- **SOCKS5 TCP-Only / HTTP / HTTPS / SSH / UDP Failure / STUN Failure**: Launch allowed in constrained mode; WebRTC completely blocked (`--webrtc-ip-handling-policy=disable_non_proxied_udp` or disabled via flags); QUIC completely disabled (`--disable-quic`).
- **Auth / TCP / Proxy-DNS Failure (including timeout + 1 retry exhausted)**: Launch refused immediately with structured error code.
- *Alternative rejected*: Allowing WebRTC or QUIC on unverified UDP relays or falling back to host interfaces on proxy failure.

### 2. Zero direct fallback rule
Under no circumstances may a profile configured with a proxy fall back to direct host connectivity. If the proxy fails initial probe or drops mid-session, all profile network traffic MUST halt immediately.

### 3. Credential-safe probe cache with HMAC indexing
Probe results are cached in-memory with a maximum TTL of 10 minutes (600 seconds).
- The cache key is computed as: `HMAC_SHA256(secret_salt, protocol || ":" || host || ":" || port || ":" || username || ":" || cred_version || ":" || interface_id || ":" || dns_mode)`.
- Raw passwords and bearer tokens MUST NEVER be used as cache keys or stored in cache entries.
- Cache is strictly single-flight: concurrent probe requests for the same target deduplicate onto a single pending promise with a deterministic 5-second timeout plus one jittered retry.

### 4. Cache invalidation triggers and mid-session termination
The probe cache is immediately invalidated and all affected active proxied browser sessions are terminated upon:
- Host network interface change or default gateway change.
- Proxy configuration mutation in the profile database.
- Mid-session transport loss (detected via local SOCKS5 relay or heartbeats): TCP drop, auth revocation, DNS resolution failure, UDP_ASSOCIATE loss, or QUIC-only loss.

### 5. Chromium launch flag composition
`src/main/launcher/chromium.ts` translates probe results into immutable startup flags:
- Constrained WebRTC: `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` and WebRTC media stream restrictions.
- Blocked WebRTC: `--disable-webrtc` (or policy equivalent blocking all ICE candidates).
- Disabled QUIC: `--disable-quic`.
- Proxy flags: `--proxy-server=<scheme>://<host>:<port>` and `--proxy-bypass-list=<-loopback>`.

### 6. Scope separation: p0f deferred
Operating system TCP/IP stack fingerprinting (p0f SYN packet imitation) is explicitly deferred to a future dedicated change and is not a prerequisite or component of this transport policy slice.

## Risks / Trade-offs

- [Probe latency at startup] -> Single-flight promise sharing and 10-minute HMAC caching minimize overhead; probe timeouts clamped to 5s.
- [Mid-session process termination] -> Abrupt browser termination is preferred over silent IP leak. UI/API surfaces receive structured termination events.

## Migration Plan

- Backward-compatible rollout: Validates proxy settings at profile launch. AdsPower V1/V2 endpoints receive standard start/stop responses or explicit probe failure codes.
- Rollback: Revert launch flag injection to prior baseline; cache is non-persistent in memory.
