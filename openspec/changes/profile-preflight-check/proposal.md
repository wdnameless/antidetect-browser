## Why

Afina operationalizes a check-before-login loop (built-in IP/WebRTC/geo test, Pixelscan pass). We have geo emulation, WebRTC policy and proxy latency tests, but no single preflight verdict that tells a user "this profile is consistent, safe to log in". Mismatched timezone/language/IP remains the top self-inflicted ban cause.

## What Changes

- Add a preflight service that, given a profile, verifies: proxy liveness, egress IP geo vs fingerprint locale/timezone, WebRTC candidate hygiene, DNS egress path, and QUIP/UDP relay state (from `udp-socks5-quic-relay` when available; degrades gracefully before it lands).
- Expose `POST /api/profiles/:id/preflight` returning a machine-readable verdict with per-check status and reason codes; optional `blockOnFail` launch guard.
- Add a panel action + inline verdict badge per profile row.

## Capabilities

### New Capabilities
- `profile-preflight-check`: pre-launch consistency verification contract.

### Modified Capabilities

None.

## Impact

- New `src/main/preflight/` module, API route, minimal panel wiring; consumes `proxyManager`, `geoEmulation`, `transportPolicy` read-only.
- Dependency: soft on `udp-socks5-quic-relay` (reads relay state when present).
