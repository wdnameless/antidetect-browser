# Tasks: add-script-engine-catalog

## 1. Specs

- [x] 1.1 Write `specs/script-engine/spec.md` (sandbox, run lifecycle, keys, triggers)
- [x] 1.2 Write `specs/script-catalog/spec.md` (manifest, checksum install, review-before-install, URL setting)

## 2. Backend (main process)

- [x] 2.1 Schema: `scripts`, `script_runs`, `global_keys`, `triggers` tables (idempotent)
- [x] 2.2 `src/main/scripts/keyStore.ts` — global keys over secretStore (masking + reveal)
- [x] 2.3 `src/main/scripts/scriptEngine.ts` — worker+vm sandbox, app facade, 60s terminate, http budget, worker queue (max 5)
- [x] 2.4 `src/main/scripts/triggerScheduler.ts` — 30s tick, interval/daily matching, event hooks subscription
- [x] 2.5 `src/main/scripts/scriptCatalog.ts` — manifest fetch, sha256 checksum install, catalog URL setting
- [x] 2.6 `profileManager.ts` — status-change event hook for triggers
- [x] 2.7 `config.ts` — CATALOG_URL default + settings persistence
- [x] 2.8 API routers: `scripts.ts`, `keys.ts`, `triggers.ts`, `catalog.ts` + wire into `server.ts`

## 3. Frontend (renderer)

- [x] 3.1 Scripts page: list/CRUD, Run (profile picker), run history with status + log
- [x] 3.2 Keys section (masked list, set/delete, reveal-on-click)
- [x] 3.3 Triggers section (CRUD, enable/disable toggle, interval/daily/event)
- [x] 3.4 Catalog page: cards (name/description/tags), View code modal, Install
- [x] 3.5 Settings: Catalog URL field
- [x] 3.6 i18n EN/RU strings

## 4. Tests

- [x] 4.1 `tests/unit/scriptSandbox.test.ts` — no require/fs/process escape, keys masked
- [x] 4.2 `tests/unit/checksum.test.ts` — sha256 match/mismatch gating
- [x] 4.3 `tests/unit/triggerScheduler.test.ts` — interval/daily matching logic

## 5. Verification

- [x] 5.1 `npm run typecheck` (main + renderer) passes
- [x] 5.2 `npx vitest run` — all green (103 pre-existing + new)
- [x] 5.3 `openspec validate add-script-engine-catalog` passes