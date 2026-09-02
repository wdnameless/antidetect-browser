## Why

Modern platforms increasingly serve traffic over QUIC/HTTP3 (UDP). Our SOCKS5 support proxies TCP only; without UDP ASSOCIATE relay, QUIC traffic either leaks the real IP or silently falls back, both detectable. Competitor Afina ships UDP-over-SOCKS5 as a flagship anti-leak feature. The merged `network-transport-policy` child added UDP/STUN probe detection and fail-closed WebRTC policy, but no actual UDP relay.

## What Changes

- Add a SOCKS5 UDP ASSOCIATE relay layer so QUIC/HTTP3 and WebRTC UDP traffic egress through the profile proxy, never the host interface.
- Fail closed: when the proxy does not support UDP ASSOCIATE, QUIC/HTTP3 MUST be disabled for that profile (force TCP fallback) and the UI/API MUST surface the degraded state.
- Extend proxy health data with a UDP-capability probe result (STUN over relay) reused by diagnostics.
- Gate activation per profile with a policy flag; default = relay when supported, else hard-disable QUIC.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `network-transport-policy`: adds UDP relay, QUIC fail-closed fallback, and UDP-capability probing requirements.

## Impact

- `src/main/proxy/transportPolicy.ts`, new `src/main/proxy/udpRelay.ts`, launcher flag composition in `src/main/launcher/chromium.ts`, proxy diagnostics API.
- Risk: Chromium QUIC flag behavior differs across versions; pinned Chromium 148 flags must be verified with packet-level evidence.
- Evidence: leak test (real IP invisible on HTTP/3 endpoint + WebRTC) committed under `evidence/`.
