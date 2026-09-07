## 1. Program governance

- [ ] 1.1 All children validated with `openspec validate <child> --strict` before implementation; umbrella validation once children exist.
- [ ] 1.2 Wave A+B children spawn in parallel worktrees (max 8 concurrent subagents, repo cap); each child gets one file-owner map; `src/main/api/server.ts` and page registry edits serialized through the Wave B integration owner at merge.
- [ ] 1.3 Every merge to main requires: full vitest suite green (baseline 601 + child additions), `npx tsc -p tsconfig.main.json --noEmit` clean, and updated CHANGELOG entry.

## 2. Wave A — catalog + rotation + engine surfaces (parallel)

- [ ] 2.1 `finish-fingerprint-catalog`: close tasks 1.5 (v2 data bundle), 2.4 (AudioContext/OS audio coherence), 3.1 (coherent archetype sampling in generation service) of `add-coherent-fingerprint-catalog`; suite covers bundle integrity, audio coherence rules, and sampling coherence for 100 seeds.
- [ ] 2.2 `add-engine-level-hardening` task-set extension: add spec rows + tasks for WebGPU adapter/limits spoofing, WebAuthn platform-authenticator spoofing, and the Motion CDP domain; keep existing 10 tasks; each new row carries a JS-interim fallback marker (`TODO(engine-parity)`).
- [ ] 2.3 `add-bulk-fingerprint-rotation`: `POST /api/v1/browser-profile/bulk-fingerprint` (modes rotate/patch), per-item report, running-profile skip, coherence validation; unit + sandbox tests.

## 3. Wave B — automation surfaces (parallel)

- [ ] 3.1 `add-motion-cdp-domain`: motor-seed derivation, trajectory engine (Fitts + seeded jitter), typing pace + typo model, CDP command handler (hidden domain, fail-closed without pointer), fake-WS integration tests; MCP tools `browser.human_type`/`browser.human_click`; SDK methods.
- [ ] 3.2 `add-webstore-extension-installer`: update-protocol CRX fetch, signature header verification, unpack + versioned registration in extensionManager, URL/ID/local input normalization; mocked-transport tests.
- [ ] 3.3 `add-motion-flow-nodes`: `human_click`/`human_type` flow node types (schema, compiler, validator, canvas palette + config forms); compiled-program snapshot tests; live-run binding.

## 4. Wave C — UX suite (after A/B merge; parallel among themselves)

- [ ] 4.1 `add-task-calendar`: month-grid calendar page rendering task-group cron triggers; nav entry; component tests.
- [ ] 4.2 `add-screen-capture-protection`: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` toggle + idle auto-lock; seam-injected unit tests for affinity call and lock timer.
- [ ] 4.3 `add-movable-data-root`: copy-verify-swap relocation with progress reporting and launch gating; fs-sandbox tests.
- [ ] 4.4 `add-profile-window-badge`: per-profile color + name badge on window icon; badge-render unit tests.
- [ ] 4.5 `add-extra-launch-args`: per-profile launch arg list appended last; arg-merging tests (override precedence).
- [ ] 4.6 `add-folder-bookmarks`: managed bookmarks folder per folder-linked site; launch-time rewrite; JSON-shape tests.

## 5. Program closure

- [ ] 5.1 Reconcile child evidence: each child's tasks all checked, tests green, CHANGELOG updated; archive children in dependency order, umbrella last.
- [ ] 5.2 Verify no child left `TODO` markers unaccounted for (JS-interim fallbacks must reference their engine-parity patch row).