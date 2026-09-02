## Why

`syncClient.ts` implements AES-256-GCM encrypted bundle sync against a remote endpoint, but the server side is external — teams cannot self-host, and Afina monetizes exactly this (extra seats, shared profile database, cloud versioning). Umbrella task 3.4 (`harden-sync-server-verification`) hardens server security; this change ships the missing server itself.

## What Changes

- Self-hostable sync server package implementing the existing syncClient wire protocol: bundle upload/download, versioning, conflict resolution parity, per-workspace isolation.
- Workspace roles: owner / editor / viewer with least-privilege enforcement on profile bundles and variables.
- Audit log of sync operations (who pushed/pulled what, when); rate limits and auth on par with panel.
- Docker Compose deployment + migrations; E2E test: two clients syncing through the server with conflict.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `sync-protocol`: adds server-side endpoint, role, and audit requirements to the existing client-side sync contract.

## Impact

- New `packages/sync-server/` (Express + SQLite/Postgres), docker-compose, RBAC middleware; client unchanged (protocol-compatible).
- Complements umbrella 3.4; that child adds hardening evidence on top of this server.
