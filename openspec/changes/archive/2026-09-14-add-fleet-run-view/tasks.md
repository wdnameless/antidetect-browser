## 1. Run scope

- [x] 1.1 Run controls in `FlowCanvas.tsx`: select multiple profiles (reusing the existing profile picker source) and a concurrency value; default to the current single-profile behaviour when nothing is chosen. **This child is serialized after `add-flow-recorder` on `FlowCanvas.tsx`.**
- [x] 1.2 Pass the selection through to the existing `POST /api/flows/:id/run` `profile_ids` and `concurrency` fields. Verify the response's `taskGroupId` and the way per-profile task uuids are obtained (`GET /api/task-groups/:id/tasks`) before writing the client.

## 2. Fleet state

- [x] 2.1 New `src/renderer/src/components/FleetPanel.tsx`: one row per profile with its name, current node, progress, and terminal state.
- [x] 2.2 Multi-stream reducer in `src/renderer/src/flowLiveRun.ts`: fold N log streams into per-profile state, reusing the existing line parsing (`parseSseLine`, `extractNodeTiming`) rather than re-deriving it. Unit-test the reducer directly.
- [x] 2.3 Derive progress from the flow document's node count and the observed `[FLOW_SPAN_END]` events. Test with a partial stream.
- [x] 2.4 Selecting a row shows that profile's log, reusing the existing log-panel rendering.

## 3. Lifecycle

- [x] 3.1 Handle per-profile terminal states independently: one profile failing MUST NOT mark the run finished while others are still working.
- [x] 3.2 Stop/terminate the whole run through the existing task-group stop endpoint. Verify the endpoint and its response shape first.
- [x] 3.3 A run with more profiles than the concurrency cap MUST show queued profiles distinctly from working ones.

## 4. Verification

- [x] 4.1 Tests: reducer across N streams, progress derivation, one-failure-among-many, queued-vs-working.
- [x] 4.2 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-fleet-run-view --strict`.
