## Why

Afina bulk-checks 500 proxies at once (latency, exit IP, geo, UDP probe, reason codes) and keeps a `proxy_usage` cache that suppresses country/timezone drift by re-attaching the same proxy consistently. We have single-proxy latency tests and egress geolocation only; mass proxy ops remain manual and drift-prone.

## What Changes

- Bulk health check: concurrent checks over the whole proxy pool or filtered subset (500+), each reporting latency, exit IP, geo, protocol-specific probes (UDP for SOCKS5 via `udp-socks5-quic-relay` probe when present), and stable reason codes.
- `proxy_usage` cache: records which profile last used which proxy, when, and resolved country; consumed by preflight and profile attach to suppress drift.
- REST API: `POST /api/proxies/check-all`, `GET /api/proxies/:id/health`, usage query endpoints; panel bulk-check action later slice.

## Capabilities

### New Capabilities
- `proxy-health`: bulk checking, reason-coded verdicts, and anti-drift usage cache.

### Modified Capabilities

None.

## Impact

- New `src/main/proxy/proxyHealth.ts`, routes under `src/main/api/routes/`, SQLite tables; consumes `proxyManager` read paths, optional UDP probe hook from `udp-socks5-quic-relay` (graceful skip when absent).
