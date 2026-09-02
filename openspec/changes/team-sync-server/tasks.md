## 1. Server core

- [ ] 1.1 `packages/sync-server/`: bundle push/pull endpoints implementing syncClient wire protocol byte-for-byte; per-workspace namespacing.
- [ ] 1.2 Versioned bundle storage with conflict resolution identical to client expectations (last-writer + vector metadata as per protocol).
- [ ] 1.3 Tests: protocol round-trip against real syncClient fixtures, conflict cases, corrupted bundle rejection.

## 2. Roles and audit

- [ ] 2.1 RBAC: owner/editor/viewer; viewers read-only, editors push, owners manage members; deny-by-default middleware tests.
- [ ] 2.2 Audit log table + query endpoint: actor, action, bundle id, timestamp; rate limiting + token auth.
- [ ] 2.3 Tests: role matrix enforcement, audit completeness, rate-limit trips.

## 3. Deployment and E2E

- [ ] 3.1 docker-compose.yml + idempotent migrations; `.env.example` parity.
- [ ] 3.2 E2E: two client instances sync through server, forced conflict resolves deterministically; evidence committed.
