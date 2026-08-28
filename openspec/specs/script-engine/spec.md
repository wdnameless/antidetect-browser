# script-engine Specification

## Purpose
TBD - created by archiving change add-script-engine-catalog. Update Purpose after archive.

## Requirements

### Requirement: Sandboxed script execution

The system SHALL execute user scripts inside a `node:vm` context running in a `worker_threads` Worker with a hard timeout of 60 seconds (worker `terminate()`), a memory limit (`resourceLimits`), and NO access to Node primitives: the context SHALL NOT expose `require`, `process`, `fs`, `child_process`, or `net`. Scripts interact with the app only through an `app` facade: `app.profiles.list/get/start/stop`, `app.proxy.list`, `app.keys.get/set`, `app.http.fetch` (fetch with timeout, at most 100 HTTP calls per script run), `app.log(msg)`.

#### Scenario: Script cannot escape the sandbox

- **WHEN** a script calls `require('fs')`, reads `process.env`, or touches any Node global
- **THEN** the call throws (or resolves to undefined) and the run is marked `error` — the host is unaffected

#### Scenario: Runaway script is terminated

- **WHEN** a script does not finish within 60 seconds (e.g. `while(true){}`)
- **THEN** its worker is terminated, the run is marked `timeout`, and other runs continue

#### Scenario: HTTP call budget

- **WHEN** a script exceeds 100 `app.http.fetch` calls in one run
- **THEN** further calls throw and the run finishes as `error`

### Requirement: Script CRUD and runs

The system SHALL store scripts in `scripts` (id, name, code, created_at, updated_at, last_run_at, last_status) and runs in `script_runs` (id, script_id, profile_ids JSON, status running|done|error|timeout, log, started_at, finished_at). API: CRUD `/api/v1/scripts`, asynchronous `POST /api/v1/scripts/:id/run {profile_ids[]}` (run id returned immediately), run status/log via `GET /api/v1/scripts/:id/runs`.

#### Scenario: Run a script across profiles

- **WHEN** the user posts a run with one or more profile ids
- **THEN** one worker per profile starts (FIFO queue, max 5 concurrent), a `script_runs` row is created as `running`, and the API responds immediately with run ids

#### Scenario: Run log is captured

- **WHEN** the script calls `app.log('...')`
- **THEN** the message appears in the run's log and `GET .../runs` returns it with the final status

### Requirement: Global keys with encrypted storage

The system SHALL store global key/values in `global_keys` (key, value_enc, updated_at) with values encrypted via the machine-local secret store (AES-256-GCM). The list endpoint SHALL return key names only; plaintext SHALL be exposed only via a dedicated reveal endpoint and, for scripts, only inside the worker's memory (`app.keys.get`) — never in logs.

#### Scenario: List masks values

- **WHEN** the user requests `GET /api/v1/keys`
- **THEN** the response contains key names and `has_value` flags but no plaintext values

#### Scenario: Script reads a key without leaking it

- **WHEN** a script calls `app.keys.get('api_token')`
- **THEN** the decrypted value is returned into the worker memory only, and `app.log(value)` is the script author's choice — the engine itself never writes key values into run logs

### Requirement: Triggers (schedule and event)

The system SHALL store triggers in `triggers` (id, name, script_id, type schedule|event, schedule, event, enabled). `src/main/scripts/triggerScheduler.ts` SHALL tick every 30 seconds and fire matching schedule triggers (interval-in-minutes or daily HH:MM, implemented with a plain interval scheduler — no external cron dependency). Event triggers SHALL fire on profile status changes (`profile_started` / `profile_stopped`) via hooks in profileManager. API: CRUD `/api/v1/triggers` + enable/disable toggle.

#### Scenario: Interval trigger fires

- **WHEN** an enabled trigger with schedule interval 60 minutes passes its due time
- **THEN** the bound script runs once (not once per tick) and the last-fired time is remembered

#### Scenario: Profile-started event trigger

- **WHEN** a profile's status becomes `running`
- **THEN** every enabled trigger with `event='profile_started'` runs its script with that profile id

#### Scenario: Disabled trigger never fires

- **WHEN** a trigger is disabled
- **THEN** neither the scheduler nor event hooks run its script
