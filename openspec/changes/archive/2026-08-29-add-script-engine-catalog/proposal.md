# Proposal: add-script-engine-catalog

## Why

Operators repeat the same multi-step routines (log in, check balance, post an update) across dozens of profiles. Sprint 3 mirrors manual actions; Sprint 4 lets users codify those routines once as small JS scripts and run them across many profiles on demand, on a schedule, or on profile events. A shared catalog (GitHub raw manifest) distributes ready-made scripts with checksum verification so nothing is executed sight-unseen.

## What Changes

- **Script engine (4.1)**: new `src/main/scripts/scriptEngine.ts` executing user JS inside `node:vm` within a `worker_threads` Worker (hard `terminate()` timeout of 60 s, memory cap via `resourceLimits`, no `require`/`process`/`fs`/`child_process`/`net` in the context). The sandbox gets a narrow `app` facade: `app.profiles.list/get/start/stop`, `app.proxy.list`, `app.keys.get/set`, `app.http.fetch` (fetch with timeout, max 100 calls per script run), `app.log(msg)`. New tables `scripts` (id, name, code, timestamps, last_run_at, last_status) and `script_runs` (id, script_id, profile_ids JSON, status running|done|error|timeout, log, started_at, finished_at). API: CRUD `/scripts`, async `POST /scripts/:id/run {profile_ids[]}`, run status via `GET /scripts/:id/runs`. Concurrency: one worker per profile, max 5 workers, FIFO queue.
- **Global keys (4.2)**: new `global_keys` table (key, value_enc, updated_at) with values encrypted through `util/secretStore` (AES-256-GCM). API `/keys` CRUD; list returns names only, plaintext only via a dedicated reveal endpoint and inside a worker's memory (never logged).
- **Triggers (4.3)**: new `triggers` table (id, name, script_id, type schedule|event, schedule, event, enabled). `src/main/scripts/triggerScheduler.ts` ticks every 30 s and matches simple cron-like schedules (interval-in-minutes or daily HH:MM) — no external dependencies; event triggers (`profile_started`/`profile_stopped`) hook the existing status changes in profileManager. API CRUD `/triggers` + enable/disable toggle.
- **Script catalog (4.4)**: new `src/main/scripts/scriptCatalog.ts` fetching a JSON manifest ({scripts: [{id, name, description, tags[], version, url, checksum_sha256}]}) from a configurable GitHub raw URL (default stub, editable in Settings). Install flow: fetch → verify sha256 (`CHECKSUM_MISMATCH` on failure) → user reviews the code in the UI → explicit Install click writes into `scripts`. API: `GET /catalog`, `POST /catalog/install {catalog_id}`.

## Impact

- **Affected specs**: new capabilities `script-engine` and `script-catalog` (no existing specs modified).
- **Affected code**:
  - `src/main/db/schema.ts` — 4 new tables (idempotent).
  - new `src/main/scripts/` (scriptEngine, keyStore, triggerScheduler, scriptCatalog), `src/main/api/routes/scripts.ts`, `routes/keys.ts`, `routes/triggers.ts`, `routes/catalog.ts`; wired into `server.ts`.
  - `profileManager.ts` — tiny event hook (status change callbacks) for event triggers; `config.ts` — catalog URL constant + settings persistence.
  - Renderer: Scripts page (CRUD + run + run history/log), Keys section, Triggers section, Catalog page (cards, View code modal, Install), Settings field for catalog URL; i18n EN/RU.
- **Non-goals**: npm/module loading inside scripts, script-to-script imports, distributed/remote execution, cron expressions beyond interval/daily, per-key ACLs, catalog publishing tooling.