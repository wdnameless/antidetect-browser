## 1. Seeds and engines

- [x] 1.1 Implement `deriveMotorSeed(profileSeed)` domain-separated derivation in `src/main/motion/seeds.ts` (reuse fingerprints derivation utilities).
- [x] 1.2 Implement `planGlide` trajectory engine: Fitts duration `a + b·log2(2D/W)`, seeded bezier path, 8% overshoot-and-correct; unit tests for determinism, width monotonicity, bounds.
- [x] 1.3 Implement `planTyping`: seeded log-normal per-key pace (150–350ms), 2% typo + Backspace correction model, `allowTypos` gate; unit tests for pace bounds, correction shape, determinism.

## 2. Session registry and CDP handler

- [x] 2.1 Implement `MotionSessionRegistry` (per-profile pointer lifecycle, fail-closed on non-`createPointer` without pointer) in `src/main/motion/session.ts`; unit tests.
- [x] 2.2 Implement Motion command handler on the profile browser-level WS path (tunnel-owned): route `Motion.*` commands, execute plans via browser input synthesis (no `Page.evaluate`), report `durationMs`; fake-WS integration test for full roundtrip.
- [x] 2.3 Verify hidden-domain requirement: `Motion` absent from `Schema.getDomains` responses and `/json/protocol` output; assert distinct error codes for missing pointer.

## 3. Automation surfaces

- [x] 3.1 MCP tools `browser.human_type`, `browser.human_click` under `mcp:automation` scope, reusing Motion sessions; tool wiring + scope/redaction tests.
- [x] 3.2 SDK methods `motion.createPointer/glideTo/tap/enterText/destroyPointer` in Node and Python SDKs (REST surface `/api/v1/motion/:profileId/*`; OpenAPI paths + conformance suite green).
- [x] 3.3 Add `human_click` and `human_type` flow node types: schema (`flows/types.ts`), compiler emission calling the Motion session, validator rules, canvas palette + config forms (`FlowCanvas.tsx`), live-run log binding; compiled-output snapshot tests per node type.

## 4. Verification and validation

- [x] 4.1 Update CHANGELOG; run full vitest suite (601 baseline + new) and typecheck; all green.
- [x] 4.2 Run `openspec validate add-motion-cdp-domain --strict` and verify compliance.