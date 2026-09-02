## Why

Our script-engine runs individual scripts with cron triggers, but there is no batch orchestration: no queue, no parallelism cap, no retries, no time windows, no per-task live status. Afina's Task Groups (run one flow across hundreds of profiles with activeSession limits, repeatCount, time windows, randomized order, per-task logs) is the feature that makes mass multi-accounting operationally viable.

## What Changes

- New `task-groups` subsystem over `script-engine`: a task group binds a script + a set of profiles + execution policy.
- Execution policy: `activeSession` parallelism cap, per-task timeout, `repeatCount` retries with backoff, time-window scheduling (cron-compatible), randomized profile order option.
- Lifecycle states per task: waiting | working | finished | error | stop; live log streaming per task.
- REST API: create/list/start/stop task groups, task status query, log streaming; panel surface follows in a later slice.

## Capabilities

### New Capabilities
- `task-groups`: batch scheduling, queueing, retry and observability contract.

### Modified Capabilities

None.

## Impact

- New `src/main/scripts/taskGroups.ts` + `taskQueue.ts`, API routes under `src/main/api/routes/`, persistence in existing SQLite; script-engine gains an invocation handle API (read-only for other slices).
- Foundation for `cookie-robot-warmup` and `nocode-flow-canvas` triggers.
