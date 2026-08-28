# Proposal: add-teams-rbac-cloud-sync

## Why

The desktop app is single-user today: profiles live in one local SQLite database and Cloud Sync pushes plaintext bundles to a server the operator fully trusts. Commercial distribution (Free/Pro tiers) needs team collaboration — several operators sharing one pool of profiles — without leaking profile plaintext (proxies, cookies, fingerprints) to the server operator. Teams + RBAC + an encrypted zero-knowledge sync protocol turn the app into a sellable multi-seat product while keeping Pro differentiation (teams/sync gated behind a license).

## What Changes

- **Teams & RBAC**: new `teams` / `team_members` tables; workspace model (personal vs team); owner/member roles with per-member permission flags (run / add / remove profiles, invite); owner-only member removal; account transfer from a team goes only to the owner's personal space; invite flow via email + activation code (pending → active).
- **Encrypted sync protocol (wire-format v1)**: client encrypts profile bundles with AES-256-GCM using a per-team key derived via HKDF from the owner's team master key; the server stores only `{bundle_id, team_id, device_id, ciphertext, nonce, version, updated_at}` and never sees plaintext; REST API for team create/invite/accept and bundle push/pull with `since=` deltas and last-write-wins conflict resolution by `updated_at`; cloud (default URL) / custom (self-host) endpoint switch in Settings.
- **Licensing (Free/Pro)**: license key = base64url payload + Ed25519 signature, offline validation with a pinned public key; Free = no teams/sync (API returns `LICENSE_REQUIRED`), Pro = everything; key stored in the OS-protected secret store.
- **Server package**: standalone `server/` npm package (Node + Express + SQLite, native `node:crypto` only, no paid deps) implementing the same REST API, with Dockerfile + docker-compose + self-host README.

## Impact

- **Affected specs**: new capabilities `teams`, `sync-protocol`, `licensing` (no existing specs are modified).
- **Affected code**:
  - `src/main/db/schema.ts` — 3 new tables (additive, existing migrations untouched).
  - new `src/main/teams/` (teamManager, teamCrypto, syncClient) and `src/main/licensing/` modules.
  - `src/main/api/server.ts` + new `src/main/api/routes/teams.ts`, `sync.ts`, `licensing.ts` (additive routers).
  - Renderer: workspace switcher in sidebar, new Teams page, Settings Sync/License tabs; existing pages keep working — Profiles only gets an optional workspace filter.
  - new `server/` package (fully isolated from the Electron app).
- **Non-goals**: real-time sync (polling `since=` is enough), SSO/OIDC, payment processing (license keys are generated offline by the vendor), migrating the legacy plaintext Cloud Sync flow.