# Tasks: add-quick-wins-pack

## 1. Specs

- [x] 1.1 Write `specs/account-vault/spec.md` (encrypted storage, masked list, reveal, Vault tab)
- [x] 1.2 Write `specs/network-diagnostics/spec.md` (running-only checks, NOT_RUNNING, honest dns_leak null)
- [x] 1.3 Write `specs/profile-tags/spec.md` (many-to-many, attach/detach, tag_id filter, chips UI)
- [x] 1.4 Write `specs/profile-trash/spec.md` (soft delete, restore, purge 30d, Trash UI)
- [x] 1.5 Write `specs/csv-export/spec.md` (columns, escaping parity with parseCsv, UI button)

## 2. Backend (main process)

- [x] 2.1 Schema: `account_credentials`, `tags`, `profile_tags` tables + `profiles.deleted_at` column (idempotent)
- [x] 2.2 `src/main/vault/accountVault.ts` — CRUD over secretStore encryption
- [x] 2.3 `src/main/diagnostics/networkDiagnostics.ts` — CDP collection (IP/geo, tz match, WebRTC, UA consistency)
- [x] 2.4 `src/main/tags/tagManager.ts` — CRUD + attach/detach + tag-aware profile list
- [x] 2.5 `profileManager.ts` — soft delete, list filters `deleted_at IS NULL`, trash helpers + purge
- [x] 2.6 `src/main/util/csv.ts` — escapeCsvField (parity with parseCsv)
- [x] 2.7 API routers: `vault.ts`, `diagnostics.ts`, `tags.ts`, `trash.ts` + export endpoint in `profiles.ts`; wire into `server.ts`

## 3. Frontend (renderer)

- [x] 3.1 Vault tab in the profile drawer (table, add/edit/delete, reveal + copy)
- [x] 3.2 Diagnostics page with ok/warn cards (IP/geo, timezone, WebRTC, consistency)
- [x] 3.3 Tag chips in Profiles table, tag filter in filter bar, tag management modal
- [x] 3.4 Trash page (restore / delete-forever) + nav entry
- [x] 3.5 Export CSV button in the Profiles header bar
- [x] 3.6 i18n EN/RU strings for all new UI

## 4. Tests

- [x] 4.1 `tests/unit/accountVault.test.ts` — encryption round-trip, masking, CRUD
- [x] 4.2 `tests/unit/csvExport.test.ts` — escaping parity with parseCsv
- [x] 4.3 `tests/unit/trash.test.ts` — soft delete, restore, delete-forever, purge

## 5. Verification

- [x] 5.1 `npm run typecheck` (main + renderer) passes
- [x] 5.2 `npx vitest run` — all tests green including the 71 pre-existing
- [x] 5.3 `openspec validate add-quick-wins-pack --strict` passes