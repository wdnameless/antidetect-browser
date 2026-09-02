## Why

Configured proxy connections must never leak real origin IP addresses through WebRTC or bypass proxy tunnels via unexpected direct UDP/QUIC fallbacks. Currently, launcher proxy configuration lacks pre-launch transport probing, deterministic fail-closed policy enforcement for WebRTC and QUIC, single-flight probe caching with credential protection, and immediate mid-session termination when proxy tunnels degrade. This change implements the deterministic network state machine specified in umbrella governance.

## What Changes

- Implement pre-launch transport validation probing for TCP, proxy-DNS, UDP_ASSOCIATE, STUN (IPv4 and IPv6), and QUIC in `src/main/proxy/proxyManager.ts` and `src/main/proxy/socks5Server.ts`.
- Enforce fail-closed browser launch arguments in `src/main/launcher/chromium.ts`: block WebRTC when UDP/STUN fail; disable QUIC when QUIC probing fails or transport is constrained; refuse launch when proxy auth, TCP, or proxy-DNS fail.
- Implement single-flight probe deduplication and an in-memory probe cache with a maximum 10-minute TTL, indexed by an HMAC key that excludes raw credentials.
- Invalidate cache entries and terminate active affected proxied browser instances immediately upon host-network changes, proxy configuration mutations, or mid-session transport losses (TCP loss, auth revocation, DNS loss, UDP/STUN loss, or QUIC-only loss).
- Ensure configured proxies never perform direct fallback under any failure condition.

## Capabilities

### New Capabilities
- `network-transport-policy`: Deterministic proxy probing, pre-launch WebRTC and QUIC enforcement, credential-safe probe caching, and mid-session termination on tunnel degradation.

### Modified Capabilities
- None

## Impact

- Affected systems: `src/main/proxy/proxyManager.ts`, `src/main/proxy/socks5Server.ts`, `src/main/launcher/chromium.ts`, and network diagnostic suites.
- Dependencies: Governed under umbrella `openspec/changes/stealth-parity-hardening` (Tasks 1.3 / 3.2 / 5.1). Operates before disposable profile instantiation. Does not include p0f proxy infrastructure (deferred separately).

## Goals / Non-Goals

**Goals:**
- Guarantee zero origin IP packet leaks across WebRTC and QUIC when proxying.
- Implement Table 6.1 network state/action matrix deterministically.
- Protect proxy credentials in memory and cache key derivations.
- Terminate affected sessions immediately on tunnel disruption or interface change.

**Non-Goals:**
- Implementing p0f OS fingerprint imitation or SYN packet manipulation (deferred).
- Public engine source code modifications.
- Multi-hop onion routing or VPN protocol management.

## Risks / Trade-offs

- [Proxy probe latency] -> Single-flight deduplication and 10-minute HMAC probe caching mitigate launch delay; fast 5-second timeout with one jittered retry prevents hanging.
- [False-positive launch refusals on unstable proxies] -> Clear tri-state diagnostic reporting in API responses rather than silent bypass.
- [Mid-session termination disrupting user workflow] -> Fail-closed security takes precedence over degraded/leaking sessions.

## Migration and rollback

- Additive network policy layer. Existing profile proxy configurations are validated before launch without DB schema migration.
- Rollback: Revert capability flag to previous proxy launch path without data loss. AdsPower V1/V2 endpoints remain backward compatible.
