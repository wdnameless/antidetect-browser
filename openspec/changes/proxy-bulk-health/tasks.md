## 1. Bulk checker

- [ ] 1.1 Implement `proxyHealth.ts`: bounded-concurrency pool checker (default 100 in-flight), per-proxy report {latencyMs, exitIp, geo, udpCapable?, status, reasonCode}.
- [ ] 1.2 Stable reason-code enum: ok, auth-failed, connect-timeout, tls-error, udp-associate-refused, stun-timeout, geo-unavailable, network-unreachable.
- [ ] 1.3 Unit tests: concurrency bound, timeout classification, mixed-protocol pool, reason-code mapping; integration test with local stub proxies.

## 2. Usage cache (anti-drift)

- [ ] 2.1 `proxy_usage` table + writer on profile start (profileId, proxyId, usedAt, resolvedCountry).
- [ ] 2.2 Drift detector: warn when a profile's candidate proxy country differs from its last used country; expose to preflight service.
- [ ] 2.3 Tests: cache write/read, drift detection true/false paths.

## 3. API

- [ ] 3.1 Routes: POST /api/proxies/check-all (filter body), GET /api/proxies/:id/health, GET /api/profiles/:id/proxy-usage.
- [ ] 3.2 API tests incl. auth parity; evidence: 500-stub pool check completes with bounded wall time.
