## 1. Sandbox surface

- [x] 1.1 Add `POST /api/v1/scripts/:id/invoke` to `routes/scripts.ts`: resolves the script, runs it through `invokeScriptTask` in its own worker, returns `{result, logs}` or a typed `{error}`. Route tests with a stub script.
- [x] 1.2 Add `app.callModule(name, args)` to the sandbox facade in `scriptEngine.ts`, implemented over the authenticated Local API (same pattern as `app.profiles.*`); throws a typed error on a non-2xx response or a module error payload. Unit test through a fake transport.
- [x] 1.3 Enforce the module-call budget: module invocations count against the existing `MAX_HTTP_CALLS` ceiling so a module cannot be used to escape the sandbox's resource limits.

## 2. Compiler

- [x] 2.1 Replace the fabricated `{ success: true }` in the `module` case with `const __moduleResult = await app.callModule(__moduleId, __args);`.
- [x] 2.2 On failure emit `[FLOW_NODE_ERROR]` with the node id and the error, and route execution to the node's error branch (or terminate per the flow's failure policy) instead of continuing the success branch.
- [x] 2.3 Bind `__moduleResult` to the node's `variable` when set, as the other node types do.

## 3. Validation

- [x] 3.1 `flows/validator.ts`: a `module` node whose `moduleId` resolves to no stored script is a validation error at save time, naming the id.
- [x] 3.2 Test: a failing module propagates as a task error, never as success.

## 4. Verification

- [x] 4.1 Test: a flow with a `module` node actually invokes the stored script with the node's arguments.
- [x] 4.2 Test: an unresolvable module id fails with a typed error naming the identifier.
- [x] 4.3 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-flow-module-execution --strict`.
