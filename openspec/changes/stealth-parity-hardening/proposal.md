## Why

The current Windows Electron/React/Express/SQLite product has useful API, RBAC, sync, script, and secret-storage foundations, but its stealth claims exceed its enforceable browser, network, supply-chain, SDK, and validation contracts. This umbrella program establishes measurable parity without treating closed-engine competitor claims as verified facts or copying insecure patterns.

## What Changes

- Deliver phased releases: Windows first, Linux and macOS only through later bounded slices.
- Establish a deterministic parity baseline plus dated external-checker evidence from a clean Windows VM; manual checkers and an always-successful WebRTC script cease to count as release gates.
- **BREAKING**: after both approvals and verified clone-only `LEGACY_CORPUS_SIGNED`, deny production Camoufox writes and remove its product path; reject silent conversion and preserve raw data indefinitely until explicit cleanup.
- Keep `fingerprint-chromium` 148 as the base and define a narrow private engine patch-set for engine-owned fingerprint surfaces rather than building Chromium from zero or relying on MV3 JavaScript spoofing.
- Add 30 curated, coherent Windows profile families based on documented market distributions, not harvested device fingerprints.
- Add fail-closed UDP/QUIC/WebRTC policy, disposable profiles, signed immutable runtime delivery, standalone Node/Python SDKs, and a constrained MCP server.
- Preserve AdsPower V1/V2 compatibility and the existing DPAPI/AES secret store, host allowlist/rate limits, teams/RBAC/E2E sync, Action Syncer, Scripts, and server mode.
- Gate Widevine and Google validation-header investigation behind separate legal/protocol research; defer p0f proxy infrastructure and any Rust SDK.
- Make telemetry opt-in and privacy-first, excluding URLs, page data, cookies, and proxy credentials.

## Capabilities

### New Capabilities
- `stealth-parity-program`: Observable release, engine-boundary, profile-coherence, runtime-trust, network-safety, automation, privacy, compatibility, and staged-platform contracts for the parity program.

### Modified Capabilities

None. This planning umbrella owns governance only. Implementation children own and archive/sync every affected product capability delta.

## Impact

This is a planning umbrella only. Future implementation affects launcher integration, runtime distribution, browser-profile lifecycle, proxy/WebRTC/QUIC policy, public API documentation, SDKs, MCP, CI, release evidence, local secret storage, sync-server verification, repository/release hygiene, and telemetry. Only the independently complete and separately user-approved first-wave children `remove-camoufox-engine` and `establish-parity-baseline` may become executable next. Every later slice is forbidden until its own proposal, design, tasks, delta specs, strict validation, and explicit user approval exist.

### Goals

- Convert stealth and runtime integrity claims into fail-closed, measurable contracts.
- Separate an open launcher/public integration surface from a closed private engine build chain.
- Ship independently testable vertical slices with explicit dependency gates and rollback.

### Non-Goals

- Building Chromium from source as a new browser, implementing p0f proxy infrastructure, shipping Rust SDK bindings, claiming unverifiable competitor-engine behavior, collecting real-device fingerprints, or bypassing legal/protocol controls for Widevine or Google headers.

### External prerequisites

- A separately governed private engine repository and CI identity.
- Ed25519 release key custody, a published public key, and an Authenticode certificate before public stable release.
- Hermetic Windows builder capacity and a resettable clean Windows checker VM.
- Legal review for Widevine, Google validation headers, redistribution, and relevant licensing.

### Risks and commitments

- Private/public repo drift, signing-key compromise, checker volatility, proxy capability ambiguity, and fingerprint incoherence are release-blocking risks addressed in design and specs.
- AdsPower V1/V2 SHALL remain backward compatible. Existing profiles and raw Camoufox data SHALL not be destructively deleted or silently converted. Rollout SHALL be phased, reversible, and Windows-first.
