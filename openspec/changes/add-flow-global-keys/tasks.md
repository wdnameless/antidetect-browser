## 1. Compiler

- [ ] 1.1 Verify the gap first: confirm `src/main/flows/compiler.ts` has no reference to the key store, while `src/main/scripts/scriptEngine.ts` exposes `app.keys.get/set` to the sandbox a flow compiles into.
- [ ] 1.2 Add a way for a flow node to read a global key and to write one, compiled onto the EXISTING `app.keys` surface. Do not add a second key mechanism and do not touch `keyStore.ts`'s storage or encryption.
- [ ] 1.3 Write-back: a flow's key writes MUST persist with the same semantics scripts already have (the engine diffs and flushes on completion). Verify that path is reached for flow runs, which execute through the same task/worker pipeline.

## 2. Types, validator and canvas

- [ ] 2.1 Types: express the key binding so it is distinguishable from a flow-local variable (`FlowVariableSchema` is document-local today; do not overload it into something it is not).
- [ ] 2.2 Validator: a node referencing a key MUST be distinguishable from one referencing a flow variable, and the distinction MUST be checkable at save time.
- [ ] 2.3 `FlowCanvas.tsx` inspector: an author can bind a node to a global key and can see, at a glance, whether a given binding is a flow variable or a key. **This file may be owned by `add-flow-recorder`/`add-fleet-run-view` — serialize and coordinate.**

## 3. Verification

- [ ] 3.1 Tests: compiled output reads a key's value; a write is flushed; reading a nonexistent key is reported rather than silently empty; flow-local variables and global keys do not collide.
- [ ] 3.2 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-flow-global-keys --strict`.
