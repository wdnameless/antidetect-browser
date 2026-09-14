## Why

An earlier gap claim in this program was wrong and is withdrawn: global variables already exist end to end. There is a `global_keys` table (`src/main/db/schema.ts:185`), AES-256-GCM storage with the machine-local secret store (`src/main/scripts/keyStore.ts`), a full CRUD API (`/api/v1/keys`, `routes/keys.ts`), a "Global Keys" UI tab (`src/renderer/src/pages/Scripts.tsx:264`), and sandbox access through `app.keys.get` / `app.keys.set` with a write-back diff on completion (`scriptEngine.ts` `preloadKeyValues` / `flushKeyWrites`).

The actual, narrower gap: `compileFlowToScript` never references the key store (zero matches for `keyStore`/`global_keys`/`app.keys` in `src/main/flows/compiler.ts`). A no-code flow author therefore cannot use a global key, even though the sandbox a flow compiles into already exposes them. A flow document has its own `variables` (typed string/number/boolean/json, initialised as `__vars`), but those live only inside the document — there is no way to read or write a key shared across scripts, flows and runs.

## What Changes

- Flow nodes gain access to global keys through the sandbox surface that already exists, with the same write-back semantics scripts have.
- The flow validator and the canvas make the distinction explicit between a flow-local variable and a global key, so an author can see which one they are binding.
- Reading a key that does not exist MUST be reported, not silently treated as empty.

## Capabilities

### New Capabilities
- `flow-global-keys`: global key access from a no-code flow.

### Modified Capabilities
- `flow-canvas` / `script-engine`: the compiler surfaces the existing key store to flow nodes.

## Impact

- `src/main/flows/compiler.ts`, `src/main/flows/validator.ts`, `src/main/flows/types.ts`, `src/renderer/src/pages/FlowCanvas.tsx` (a key-binding field in the inspector).
- Tests: compiled output reads and writes a key; a missing key is reported; a flow-local variable and a global key do not collide.
