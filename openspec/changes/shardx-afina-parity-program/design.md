# Design: ShardX/Afina Parity Program

## Context and Scope

Program umbrella grouping nine bounded children against the gap analysis vs ProxyShard/ShardX and Afina.io. Baseline: main @ f3930b2, 601/601 tests, typecheck clean. All children execute in isolated worktrees, one file owner per slice, sequential merges back to main.

## Wave Structure and Parallelism

```
Wave A (parallel)                Wave B (parallel)              Wave C (after A/B merge)
├─ finish-fingerprint-catalog    ├─ add-webstore-installer      ├─ add-task-calendar
├─ add-bulk-fingerprint-rotation ├─ add-motion-cdp-domain       ├─ add-screen-capture-protection
└─ (engine patch-set extension:   └─ (integration owner:        ├─ add-movable-data-root
   WebGPU + WebAuthn tasks into     route mounting +             ├─ add-profile-window-badge
   add-engine-level-hardening)      flow node wiring)            ├─ add-extra-launch-args
                                                                 └─ add-folder-bookmarks
```

Engine patch work is governed by stealth-parity umbrella section 4 (private engine children). This program only extends the launcher-side task list of `add-engine-level-hardening` (WebGPU, WebAuthn, Motion domain spec rows) — actual C++ patch implementation follows the private-engine path; if the private engine build chain is not yet available, children implement the JS-interim path under `interim-stealth-hardening` rules with `TODO(engine-parity)` markers, so the launcher/UI/API surface ships first and engine patches slot in later.

## Key Decisions

1. **Motion domain lives behind the CDP tunnel** (`src/main/proxy/` owns the CDP session factory; the browser-level endpoint is per-profile). Commands map 1:1 to ShardX's documented vocabulary but with our own method names hidden from `Schema.getDomains`: `Motion.createPointer`, `Motion.glideTo`, `Motion.tap`, `Motion.enterText`, `Motion.destroyPointer`.
   - Per-profile **motor seed** derived from the fingerprint seed (domain-separated derivation, same as canvas/audio sub-seeds).
   - Pointer trajectory: Fitts's-law duration `a + b * log2(D/W + 1)` with a bezier path and seeded jitter; small targets take measurably longer.
   - Typing: per-key delay from the profile's pace, optional typo + backspace correction (`allowTypos`), returns `durationMs`.
   - `paceScale` multiplies profile pace; `targetWidth` feeds Fitts's law (default 32).
   - Session without a pointer fails closed on other Motion commands.
   - Integration surfaces: MCP tools (`browser.human_type`, `browser.human_click`), flow nodes (`human_click`, `human_type`), SDK methods.

2. **WebStore installer** downloads CRX via the versioned update-protocol endpoint (no headful browsing), verifies the CRX signature header, unpacks to `data/extensions/<id>/<version>/`, and registers in the existing extensionManager. Web Store links, bare 32-char IDs, and local files all funnel into one importer.

3. **Bulk fingerprint rotation** = one endpoint, per-item report, coherence-validated before persist: `POST /api/v1/browser-profile/bulk-fingerprint` with mode `rotate` (new coherent family sample) or `patch` (targeted fields). Refuses running profiles (returns them in `skipped`).

4. **Catalog completion** closes the 3 open tasks of `add-coherent-fingerprint-catalog` (1.5 v2 bundle, 2.4 audio coherence, 3.1 coherent sampling) before any other child touches `src/main/fingerprints/`.

5. **UX children are thin vertical slices** over existing services: calendar reads task-group cron triggers; capture protection wraps `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on the main window plus idle-timer auto-lock; movable data root extends the existing configurable data dir with copy-verify-swap and launch gating; window badge uses `win.setAppIcon`-per-profile color overlays; extra launch args append after launcher defaults (last wins); folder bookmarks rewrite a managed bookmarks folder per profile launch.

6. **Single integration owner**: `src/main/api/server.ts` route mounting and `src/renderer` page/nav registry edits are serialized through one child at merge time (Wave B owner) to prevent parallel merge conflicts. All other files have disjoint owners.

## Testing Strategy

- Every child adds unit tests under `tests/unit/<area>/` and integration tests where a fixture server or CDP mock is available (follow `tests/unit/mcp/`, `tests/unit/instanceLock.test.ts` DI patterns: `setProcessInspectorExec`-style injectable seams).
- Motion domain: unit tests for trajectory math (seeded determinism, Fitts duration monotonicity in target width), typing pace distribution, typo model; integration test over a fake CDP WebSocket server asserting protocol conformance + hidden-domain behavior.
- WebStore installer: mocked update-protocol responses (happy path, invalid signature, offline); CRX unpack fixture with a minimal manifest.
- Bulk rotation: DB sandbox tests (like existing `tests/unit/db.test.ts` patterns) asserting per-item reports, running-profile skip, coherence rejection.
- UX: component-level vitest where DOM matters (calendar rendering of triggers), service tests otherwise; Playwright screenshot verification only for visual slices (per repo Visual QA standards: `document.fonts.ready` + 300ms debounce).
- Suite gate: no merge with failing tests; baseline 601 must not regress (pre-existing 2 instanceLock failures were fixed in f3930b2; suite is fully green now).

## Migration and Compatibility

- AdsPower V1/V2 API compatibility is preserved (new endpoints are additive, no response-shape changes on existing routes).
- Profile schema changes (window badge color, extra args) are nullable columns + backward-compatible defaults; existing profiles keep behavior identical.
- No data migrations required except bulk-rotation's per-item report table (in-memory, per request).

## Rollout / Revert

Each child = one feature branch = one squash merge. Revert granularity = child. Program exits when all children archived; umbrella archives last.