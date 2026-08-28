# Tasks: add-teams-rbac-cloud-sync

## 1. Specs

- [x] 1.1 Write `specs/teams/spec.md` (CRUD, RBAC matrix, workspace switcher, invites)
- [x] 1.2 Write `specs/sync-protocol/spec.md` (wire-format v1, encryption, REST API, conflict resolution)
- [x] 1.3 Write `specs/licensing/spec.md` (key format, offline validation, Free/Pro gating)

## 2. Backend (main process)

- [x] 2.1 DB schema: `teams`, `team_members`, `team_bundles_meta` tables
- [x] 2.2 `src/main/teams/teamCrypto.ts` — HKDF + AES-256-GCM, master-key generation/export
- [x] 2.3 `src/main/teams/teamManager.ts` — CRUD, RBAC checks, invites, activation codes
- [x] 2.4 `src/main/teams/syncClient.ts` — push/pull, endpoint config, versioning (LWW)
- [x] 2.5 `src/main/licensing/licenseManager.ts` — Ed25519 validation + feature gates; `publicKey.ts` pinned key
- [x] 2.6 API routers: `teams.ts`, `sync.ts`, `licensing.ts` (zod input validation, LICENSE_REQUIRED gate) + wire into `server.ts`

## 3. Sync server (`server/`)

- [x] 3.1 Express app implementing POST /api/v1/teams, /teams/:id/invites, /invites/accept, /teams/:id/bundles, GET /teams/:id/bundles
- [x] 3.2 SQLite storage via sql.js, Dockerfile, docker-compose.yml, README (self-host)

## 4. Frontend (renderer)

- [x] 4.1 Workspace switcher in sidebar (personal / teams), Profiles filtered by workspace
- [x] 4.2 Teams page: list, invite dialog (email + role + permission checkboxes), member management, cancel invites
- [x] 4.3 Settings: Sync tab (endpoint cloud/custom + URL + connection status), License tab (key activation)
- [x] 4.4 i18n EN/RU strings; monochrome style consistent with the existing renderer

## 5. Verification

- [x] 5.1 `npm run typecheck` (main + renderer) passes
- [x] 5.2 Unit tests for teamCrypto + licenseManager pass (`npx vitest run`)
- [x] 5.3 `openspec validate add-teams-rbac-cloud-sync` passes
- [x] 5.4 `docker compose config` parses for the server package