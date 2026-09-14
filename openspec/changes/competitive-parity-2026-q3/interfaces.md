# Wave 2 interfaces — competitive-parity-2026-q3

Module boundaries and public signatures. Seeded before any spawn; updated only by the orchestrator.

## Serialization map (critical)
- **`src/renderer/src/pages/FlowCanvas.tsx`** (2243 lines): owner order is
  1. `add-flow-recorder` (owns it first)
  2. `add-fleet-run-view` (serialized after)
  3. `add-flow-global-keys` (inspector binding — small, last)
- **`mcp/src/tools.ts`**: owner order is
  1. `extend-mcp-tool-surface`
  2. `add-form-filling-helper` (adds its two tools after)
- **`src/main/flows/`** (`types.ts`, `validator.ts`, `compiler.ts`): owner order is
  1. `add-form-filling-helper` (fill node)
  2. `add-flow-global-keys` (key binding)

## Wave 2a — parallel set
| Child | Owns | Notes |
|---|---|---|
| `add-flow-recorder` (B1) | `src/main/recorder/**` (new), `src/main/api/` wiring, `FlowCanvas.tsx` (first) | Reuses `src/main/util/selectorPath.ts` — do NOT write a second selector algorithm |
| `add-form-filling-helper` (B3) | `src/main/motion/persona.ts` (new), `src/main/flows/**` (first), `mcp/src/tools.ts` (second) | No new deps; locale pools are data |
| `extend-mcp-tool-surface` (B6) | `mcp/src/tools.ts` (first), `mcp/src/auth.ts`, `mcp/README.md` | Must keep the prohibited set, nonce/TTL, audit chain intact |
| `add-flow-global-keys` (B7) | `src/main/flows/**` (second), `FlowCanvas.tsx` (last) | Global keys ALREADY EXIST — compile onto `app.keys`, no new store |

## Wave 2b
| Child | Owns | Notes |
|---|---|---|
| `add-fleet-run-view` (B2) | `FlowCanvas.tsx` (after recorder), `src/renderer/src/components/FleetPanel.tsx` (new), `src/renderer/src/flowLiveRun.ts` | Backend already supports N profiles — no backend change expected |

## Existing contracts to reuse (do not re-implement)
- **Selector derivation**: `selectorPathFromSteps`, `parseSelectorPath`, `nthOfTypeSelector` (`src/main/util/selectorPath.ts`).
- **Deterministic per-profile derivation**: HMAC-SHA256 with domain separation — see `deriveMotorSeed` (`src/main/motion/seeds.ts`), `deriveSubSeeds` / `resolveSensorConfig` (`src/main/proxy/stealthNoise.ts`). Persona generation follows the same idiom.
- **Motion input**: `src/main/motion/session.ts` (`motionSessions`), `handler.ts` (`handleMotionCdpMessage`, commands `Motion.createPointer` / `glideTo` / `tap` / `enterText` / `destroyPointer`), bridge at `/motion/:profileId` (`src/main/api/motionBridge.ts`).
- **Flow run pipeline**: `POST /api/flows/:id/run` → `runFlowViaTaskGroup` (`src/main/flows/storage.ts:135`) → task group → per-profile `invokeScriptTask` workers (cap `MAX_WORKERS = 5`) → `GET /api/tasks/:uuid/logs` SSE.
- **Log line contract**: `[FLOW_SPAN_START] <id> <type> <ts>`, `[FLOW_SPAN_END] <id> <ms>`, `[FLOW_NODE_ERROR] <id> <msg>`; parsing helpers in `src/renderer/src/flowLiveRun.ts`.
- **Sandbox surface**: `app.profiles.*`, `app.proxy.*`, `app.keys.get/set`, `app.http.fetch`, `app.callModule`, `app.log` (`src/main/scripts/scriptEngine.ts` WORKER_SOURCE).
- **MCP registration**: `ToolManifest` entry in `TOOL_DEFINITIONS` + `case` in `executeToolInternal` + membership in `DEFAULT_TOOL_NAMES`/`GATED_TOOL_NAMES` (`mcp/src/auth.ts`).

## Global invariants for this wave
- The browser-injected stealth/sensor/font template rule from wave 1 does NOT apply here, but **any new injected script (recorder listener) must be valid plain JavaScript** — same class of defect.
- Any new injected script must be inert unless its feature is explicitly active (recorder off = no listener, no channel).
- No raw `element.value` assignment for anything that simulates a user; user simulation goes through the Motion input path.
