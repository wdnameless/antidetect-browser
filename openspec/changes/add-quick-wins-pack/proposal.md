# Proposal: add-quick-wins-pack

## Why

After Sprint 1 (Teams/RBAC/sync) the app supports multi-seat collaboration, but the daily operator workflow is still lossy: account logins/passwords live outside the app, there is no fast way to verify that a launched profile really leaks nothing, profiles cannot be labeled/filtered beyond groups, deleting a profile is immediate and irreversible, and reporting/backup of the profile pool requires manual copy-paste. Sprint 2 closes these five quick wins with minimal additive changes to existing modules.

## What Changes

- **Account Vault (2.1)**: new `account_credentials` table (login/password/TOTP/notes per profile), AES-256-GCM encryption at rest via the existing `util/secretStore.ts` (machine-local), masked list responses (`******` only) with a separate reveal endpoint, Vault tab in the profile drawer (add/edit/delete/reveal/copy).
- **Network Diagnostics (2.2)**: new `src/main/diagnostics/networkDiagnostics.ts` — for a RUNNING profile collects egress IP + geo through the browser proxy, compares browser timezone vs IP timezone, runs a WebRTC leak probe via `RTCPeerConnection` in the MAIN world, checks user-agent/platform consistency; DNS-leak hint is honestly `null` when not applicable. `GET /diagnostics/:profileId` returns `code:"NOT_RUNNING"` for non-running profiles. Renderer: Diagnostics page with ok/warn cards.
- **Profile Tags (2.3)**: `tags` + `profile_tags` many-to-many tables, tag CRUD API, attach/detach per profile, `tag_id` filter on profile list, tag chips in the Profiles table, tag filter in the existing filter bar, tag management modal in the style of the Groups UI.
- **Trash (2.4)**: soft delete via `profiles.deleted_at` (all list queries filter it), Trash page with restore / delete-forever, automatic purge of entries older than 30 days on app start.
- **CSV Export (2.5)**: `GET /profiles/export-csv` producing all visible columns with the same quoting rules as the existing `parseCsv`, Export CSV button in the Profiles bulk bar.

## Impact

- **Affected specs**: new capabilities `account-vault`, `network-diagnostics`, `profile-tags`, `profile-trash`, `csv-export` (no existing specs are modified).
- **Affected code**:
  - `src/main/db/schema.ts` — 3 new tables + 1 additive column (idempotent migrations only).
  - new `src/main/vault/`, `src/main/diagnostics/`, `src/main/tags/` modules; `profileManager.ts` gets trash helpers and a tag-aware list.
  - `src/main/api/server.ts` + new routers `routes/vault.ts`, `routes/diagnostics.ts`, `routes/tags.ts`, `routes/trash.ts`; export endpoint in `routes/profiles.ts`.
  - Renderer: Vault tab in the profile drawer, Diagnostics page, tag chips/filter/manage modal, Trash page, Export CSV button; i18n EN/RU for all new strings.
- **Non-goals**: password generator/policy enforcement, TOTP live codes UI, deep DNS-leak probing (returned as `null` when not measurable), scheduled trash purge beyond the startup sweep, CSV import format changes.