## Why

ShardX records what you do and writes it down as automation steps ("turn recording on to have everything you do written down as steps"), and lets you right-click an element to choose an action for it. We have a full no-code canvas (`FlowCanvas.tsx`, 12 node types, live run with per-node timing) but every step must be added and configured by hand. Recording is the adoption driver for non-coders — and it is the one automation surface where we have no story at all.

The pieces already exist: `src/main/util/selectorPath.ts` builds and matches stable `tag:nth-of-type(k)` selector chains (currently used only by `actionSyncer.ts`'s injected master listener), the flow node schemas cover click/type/human_click/human_type/wait/navigate, and `FlowCanvas.tsx` already has the node-creation path (`addNode`, ~L464) and a live-run log stream.

## What Changes

- **Capture surface (new, main process):** an injected listener in the recording profile that reports pointer, keyboard and navigation actions with a stable selector derived from the existing `selectorPath` scheme, delivered over an authenticated WebSocket to the renderer. Reuses the CDP-attach pattern already used by `motionBridge.ts` and `actionSyncer.ts`.
- **Recording mode (renderer):** start/stop recording against a chosen profile; each captured action appends a flow node through the existing `addNode` path; the operator can edit, reorder or discard a captured step before saving.
- **Element action picker (renderer + capture surface):** right-click an element in the recording browser to get a menu of actions for it (click, human click, type, human type, wait-for, extract) and append the chosen one as a node, with its selector filled in.
- Capture MUST be inert when recording is off, and MUST NOT inject anything into a profile that is not being recorded.

## Capabilities

### New Capabilities
- `flow-recorder`: action capture, step materialisation, and the element action picker.

### Modified Capabilities
None.

## Impact

- New `src/main/recorder/` (capture listener + WS bridge), `src/main/api/` wiring, `src/renderer/src/pages/FlowCanvas.tsx` (recording mode + step list), `src/main/util/selectorPath.ts` (reuse, not rewrite).
- Tests: unit coverage for action→node mapping and selector derivation; the capture listener's event parsing is tested without a browser.
