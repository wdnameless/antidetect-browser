## Why

ShardX runs one automation project across many profiles and shows a "Fleet window" of every browser in the run and the step each is on. Our backend already supports this and the UI does not: `runFlowViaTaskGroup` (`src/main/flows/storage.ts:135`) takes `profile_ids` and a `concurrency`, builds a task group, and the coordinator runs one `invokeScriptTask` worker per profile with per-task logs keyed by task uuid (`GET /api/tasks/:uuid/logs`, `scripts/taskQueue.ts` `subscribeLogs`/`broadcastLog`). `POST /api/flows/:id/run` already accepts `profile_ids[]` and `concurrency`.

`FlowCanvas.tsx` sends exactly one profile and `concurrency: 1` (`handleRunFlow`, ~L269) and follows a single SSE stream (`connectLogsStream`, ~L218). So a multi-profile run is one request away, and the missing piece is the view: which browser is on which step, how far each has got, and which one failed.

## What Changes

- **Run scope:** pick a set of profiles and a concurrency for the run, instead of the single implicit profile.
- **Fleet panel:** one row per profile in the run showing its current node, its progress through the flow, and its terminal state, updated from the existing per-task log streams.
- **Run log per profile:** selecting a fleet row shows that profile's log, reusing the existing SSE contract in `src/renderer/src/flowLiveRun.ts`.
- No backend change is expected: the task-group and log endpoints already exist. If a per-run summary endpoint is genuinely missing, that is a finding to report, not a reason to fake one.

## Capabilities

### New Capabilities
- `fleet-run-view`: multi-profile run scope, per-profile progress, and per-profile logs.

### Modified Capabilities
None.

## Impact

- `src/renderer/src/pages/FlowCanvas.tsx` (run scope + fleet panel), new `src/renderer/src/components/FleetPanel.tsx`, `src/renderer/src/flowLiveRun.ts` (multi-stream reduction).
- **Serialized after `add-flow-recorder` on `FlowCanvas.tsx`.**
- Tests: unit coverage for the multi-stream reducer and progress derivation from span lines.
