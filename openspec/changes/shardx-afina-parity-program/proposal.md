## Why

Gap analysis against ProxyShard/ShardX (Chromium 152 launcher, 895 stars, MIT) and Afina.io (commercial antidetect with 1.5M profiles/day) identified capability gaps in four areas: (1) engine-level stealth surfaces we do not own (WebGPU adapter/limits, WebAuthn platform authenticator, CDP/V8 side channels), (2) human-input automation (ShardX's hidden `Motion` CDP domain), (3) operational features (Web Store extension install, bulk fingerprint rotation, disposable noise profiles), and (4) UX/data features (task calendar, screen-capture protection, movable data root, profile window badges, extra launch args, folder bookmarks).

User decisions recorded 2026-09-07: engine-level C++ patches approved (extending the existing `add-engine-level-hardening` child), full Motion CDP domain approved, maximum parallelism across waves, competitor profile migration skipped, Widevine/Google `x-client-data` research stays deferred (legal gate), full UX scope approved.

This program is an implementation umbrella subordinate to `stealth-parity-hardening`: it groups bounded, independently approvable and mergeable children. It contains no production code itself.

## What Changes

- Engine surfaces: WebGPU adapter + limits spoofing, WebAuthn platform-authenticator spoofing, hidden CDP `Motion` domain with per-profile motor seeds (engine patch-set extension).
- Automation: human-type/human-click flow nodes, Web Store URL/ID extension installer, bulk fingerprint rotation endpoint.
- Catalog completion: close the three open tasks of `add-coherent-fingerprint-catalog` (v2 bundle, audio coherence, coherent sampling).
- UX: task calendar over cron triggers, screen-capture protection + auto-lock, movable data root with verification, per-profile window badge, extra launch args, folder bookmarks.
- Every child carries its own test requirements (unit + integration per repo Vitest conventions, 601/601 baseline must stay green).

## Capabilities

### New Capabilities
- `human-input-motion`: CDP Motion domain, motor seeds, Fitts's-law pointer glide, keystroke typing with typo model.
- `webstore-extension-installer`: URL/ID to CRX acquisition, unpacked management, per-profile binding.
- `bulk-fingerprint-rotation`: mass fingerprint update across profiles with coherence validation.
- `task-calendar`: month-grid schedule view over task-group cron triggers.
- `screen-capture-protection`: display-affinity hardening + auto-lock.
- `movable-data-root`: verified data-root relocation with progress and launch gating.
- `profile-window-badge`: per-profile colored window icon badge.
- `extra-launch-args`: per-profile appended Chromium switches.
- `folder-bookmarks`: folder-linked bookmarks propagated to member profiles.

### Modified Capabilities
- `engine-level-hardening` (via existing `add-engine-level-hardening` child tasks extension): adds WebGPU, WebAuthn, Motion domain patch tasks.
- `fingerprint-catalog` (via completing existing child): audio coherence check, v2 bundle, coherent sampling.

## Impact

- `src/main/fingerprints/`, `src/main/flows/`, `src/main/api/routes/`, `src/main/extensions/`, `src/main/launcher/`, `src/renderer/src/pages/`: all changes land through isolated worktree branches, one file owner per slice, merged sequentially into `main` after green suites.
- Tests: `tests/unit/` extensions per child; no child merges with a red suite; baseline is 601 tests green at `f3930b2`.
- Deferred: Widevine pre-warm, Google validation headers, competitor profile migration, p0f proxy infrastructure (unchanged from stealth-parity decisions).

### Goals

- Close every stealth gap that ShardX publicly documents as engine-owned while preserving our JS-layer interim hardening as fallback.
- Give automation clients human-input parity (Motion domain) without page-visible script injection.
- Finish the partially complete catalog work before adding new surfaces on top of it.
- Ship UX children as small, independently revertable slices.

### Non-Goals

- No Chromium-from-source build farm in this program (engine patches ride the existing private-engine patch-set path defined by stealth-parity 4.x).
- No competitor importers, no telemetry, no new platform ports, no Rust SDK.

### Risks and commitments

- Engine patch children depend on the private engine repo/CI prerequisites from stealth-parity 1.4; if unavailable, children degrade to JS-layer interim implementations with explicit `TODO(engine-parity)` markers per the interim-stealth-hardening spec.
- Parallel waves share `src/main/api/server.ts` route mounting; route registration is assigned to a single integration owner to avoid merge conflicts.
- Motion domain must not register itself in `/json/protocol` or `Schema.getDomains` (hidden-domain requirement) — enforced by test.