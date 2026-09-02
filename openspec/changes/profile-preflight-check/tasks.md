## 1. Preflight core

- [x] 1.1 Implement `src/main/preflight/preflightService.ts`: checks = proxy-alive, egress-ip-geo, timezone-match, language-match, webrtc-hygiene, dns-egress, quic-relay-state.
- [x] 1.2 Define verdict schema: per-check {status: pass|warn|fail, reasonCode, detail} + overall verdict; stable reason-code enum.
- [x] 1.3 Unit tests per check with mocked proxy/geoip/WebRTC states; warn vs fail policy matrix.

## 2. API and launch guard

- [x] 2.1 Add `POST /api/profiles/:id/preflight` + `GET /api/profiles/:id/preflight/last` to REST surface with panel auth parity.
- [x] 2.2 Add optional `blockOnFail` flag to profile start: refuse launch when overall verdict=fail, returning the verdict payload.
- [x] 2.3 API integration tests: verdict round-trip, blockOnFail enforcement, reason-code stability.

## 3. Panel surface

- [ ] 3.1 Add preflight action + verdict badge in the profiles UI; error copy maps reason codes to remediation hints.
- [ ] 3.2 Smoke test: full flow on a local profile with a test proxy.
