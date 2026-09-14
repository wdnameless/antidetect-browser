## 1. Capture surface

- [x] 1.1 New `src/main/recorder/` — an injected document-start listener that reports actions as typed records: `{kind: 'click'|'type'|'navigate'|'scroll'|'key', selector: string|null, text?: string, url?: string, button?: number|string}`. Derive the selector with the existing `selectorPathFromSteps` scheme from `src/main/util/selectorPath.ts` — do not write a second selector algorithm.
- [x] 1.2 WS endpoint that carries those records to the renderer for one profile at a time, authenticated with the same tunnel-key contract `src/main/api/motionBridge.ts` uses. Attach to a running profile via the existing CDP-attach helper pattern.
- [x] 1.3 Emit nothing when recording is off: no injection, no endpoint traffic. Test the guard.

## 2. Action -> node mapping

- [x] 2.1 Pure mapper: capture record -> flow node of the matching type (click -> `click`, text input -> `type` or `human_type`, navigation -> `navigate`, wait -> `wait`). Unit-test every kind, including the ignored kinds (a bare scroll with no target).
- [x] 2.2 Coalesce a typing burst into ONE `type` node rather than one node per keystroke. Test with a realistic burst.
- [x] 2.3 Emit `human_click`/`human_type` variants when the operator chooses human input for the recorded step.

## 3. Renderer

- [x] 3.1 Recording controls in `FlowCanvas.tsx`: pick a profile, start/stop, and a visible recording indicator. **This child owns `FlowCanvas.tsx` first**; `add-fleet-run-view` is serialized after it.
- [x] 3.2 Each captured action appends a node through the existing node-creation path so recorded and hand-made nodes are indistinguishable in the document.
- [x] 3.3 Captured steps are reviewable before save: discard a step, reorder, or edit its config in the existing inspector.

## 4. Element action picker

- [x] 4.1 In the recording browser, a right-click on an element reports the element plus its selector to the renderer.
- [x] 4.2 Renderer shows an action menu for that element (click, human click, type, human type, wait-for, extract) and appends the chosen node with the selector prefilled.
- [x] 4.3 The picker works without recording being active (it is a separate, on-demand surface).

## 5. Verification

- [x] 5.1 Tests: mapper coverage per kind, burst coalescing, inert-when-off guard, selector derivation round-trip through `parseSelectorPath`.
- [x] 5.2 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-flow-recorder --strict`.
