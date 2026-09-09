## Why

ShardX's launcher ships a hidden CDP `Motion` domain for human-like input: Fitts's-law pointer glides, per-profile motor seeds, per-key typing with optional typos. Our automation stack (flows, MCP, SDKs) currently types with `delay: 0` and clicks without trajectories — a strong automation signal on behavior-based anti-bot systems. The domain is merged into the browser-level protocol and hidden from `/json/protocol` and `Schema.getDomains`, so pages cannot enumerate it.

## What Changes

- New `src/main/motion/` service: motor-seed derivation (domain-separated from fingerprint seed), pointer trajectory engine (Fitts's-law duration + seeded bezier jitter), typing engine (per-key pace, typo + backspace model).
- CDP command handler exposing `Motion.createPointer`, `Motion.glideTo`, `Motion.tap`, `Motion.enterText`, `Motion.destroyPointer` on the browser-level endpoint of each running profile; hidden-domain semantics (absent from `Schema.getDomains`, absent from `/json/protocol`).
- Fail-closed session semantics: commands other than `createPointer` error without an active pointer.
- MCP tools `browser.human_type`, `browser.human_click`; SDK methods `motion.*` in Node/Python SDKs.

## Capabilities

### New Capabilities
- `human-input-motion`: Motion domain protocol, motor seeds, trajectory and typing engines, hidden-domain requirement, fail-closed pointer lifecycle, flow-node integration.

### Modified Capabilities
- `mcp-server`: adds `browser.human_type` and `browser.human_click` automation-scope tools.
- `standalone-sdks`: adds typed Motion methods to both SDKs.
- `script-engine`: flow compiler learns `human_click`/`human_type` node types.

## Impact

- `src/main/motion/` (new), `src/main/launcher/chromium.ts` (browser-level WS attach point), `src/main/mcp/` (tools), `packages/sdk-node/`, `packages/sdk-python/`, tests in `tests/unit/motion/`.
- No page-side injection: all input synthesizes through the browser input path (CDP `Input.*`-equivalent engine), never via `Page.evaluate`.
- Existing `browser.type`/`browser.click` MCP tools and flow nodes remain (non-breaking); Motion is additive.