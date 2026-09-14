## Why

A verified defect. `src/main/flows/compiler.ts:355-362` compiles a `module` node into:

```js
app.log('Calling script module ' + __moduleId);
const __moduleResult = { success: true, moduleId: __moduleId, args: __args };
```

Nothing is invoked. A flow that uses a `module` node reports success and does no work. The palette offers the node (`FlowCanvas.tsx`), the schema accepts it (`types.ts:91`), and the compiler lies about it.

The comment above the block explains the gap: "Module calls run via app.http or script engine invocation if supported". The script-engine sandbox exposes `app.profiles`, `app.proxy`, `app.keys`, `app.http` and `app.log` — and no way to invoke a stored module.

## What Changes

- `scriptEngine.ts`: the sandbox `app` gains a `callModule(name, args)` surface that reaches a stored script through the existing authenticated Local API, so the sandbox keeps its "no ambient authority" property.
- A module-invocation endpoint that resolves a module by id and runs it in its own worker, returning its result.
- `compiler.ts` `module` case: compile to a real `await app.callModule(...)` call; on an unresolved module or a module error, emit `[FLOW_NODE_ERROR]` and fail the node rather than reporting success.
- `flows/validator.ts`: reject a flow whose `module` node references a module id that does not exist, at save time.

## Capabilities

### New Capabilities
- `flow-module-execution`: real module invocation from a flow node, with typed failure.

### Modified Capabilities
- `script-engine`: adds the module-invocation surface to the sandbox facade.

## Impact

- `src/main/flows/compiler.ts`, `src/main/flows/validator.ts`, `src/main/scripts/scriptEngine.ts`, `src/main/api/routes/scripts.ts`, `tests/unit/flows/moduleNode.test.ts`.
