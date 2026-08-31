## 1. First-wave safety and corpus barrier

- [ ] 1.1 Obtain separate user approval for the complete `remove-camoufox-engine` and `establish-parity-baseline` child drafts; verify `openspec validate <child> --strict` passes for each before any implementation.
- [ ] 1.2 After both approvals, baseline creates a fully isolated disposable pre-denial executable/build, DB, and profile-filesystem clone; run every mutating Firefox fixture only there and verify `LEGACY_CORPUS_SIGNED` before production denial/removal.
- [ ] 1.3 After the barrier, removal may deny production writes/remove paths while baseline continues Chromium characterization independently; neither waits for the other's full completion beyond the barrier.
- [ ] 1.4 Establish two-repository release governance and prerequisite owners for private engine CI, signing keys/certificate, Windows builder/checker VM, legal review, secret-storage hardening, and sync-server verification.

## 2. Later-child authorization gate

- [ ] 2.1 Before implementing ANY later task below, create a full bounded child proposal/design/tasks/delta-spec set, run strict validation, and obtain explicit user approval; umbrella approval MUST NOT authorize code.

## 3. Trust and shared contracts

- [ ] 3.1 Create and approve child `secure-runtime-supply-chain` after 1.3/1.4; include JCS signature coverage, monotonic anti-rollback, key-ring rotation/revocation/recovery, rollback-state integrity, crash/locked-file recovery, SBOM, and Authenticode verification for installer, launcher, engine, and shipped PE/DLL files.
- [ ] 3.2 Version the public capability schema and public/private integration contract within the relevant child changes; verify incompatible required fields fail closed and non-secret fixtures validate in both repositories.
- [ ] 3.3 Create and approve child `harden-local-secret-storage` after 1.3; verify DPAPI-unavailable Windows writes fail closed, transactional plaintext migration, ACL validation, backup/rotation, migration-window reads, and zero secrets in logs/manifests/telemetry/cache/plain storage.
- [ ] 3.4 Create and approve child `harden-sync-server-verification` after 1.3; add missing server tests, auth/RBAC/rate-limit/host/E2E-sync security gates, and machine-readable evidence.

## 4. Identity and engine parity

- [ ] 4.1 Create child change `add-coherent-fingerprint-catalog` after 1.1/3.2; deliver exactly 30 documented Windows families and verify distribution provenance, constraint coherence, fixed-seed reproducibility, and cross-context invariants without telemetry-derived fingerprints.
- [ ] 4.2 Create and approve private child `patch-engine-identity-graphics` after 3.1/3.2/4.1; gate UA/UA-CH/GREASE, GPU/WebGPU, fonts, screen/color/HDR and cross-context evidence.
- [ ] 4.3 Create and approve private child `patch-engine-environment-surfaces` after 4.2; gate voices, battery/storage/heap, media devices, locale/timezone, and WebAuthn.
- [ ] 4.4 Create and approve private child `patch-engine-deterministic-signals` after 4.2; publish only positive signed-int32 seed vectors and replay corpus-defined legacy handling without randomization.
- [ ] 4.5 Create and approve private child `patch-engine-automation-tls` after 4.2/4.3/4.4; gate CDP/V8 and TLS ClientHello/JA4. Every private child pins upstream commit/artifact digest, license review, security-rebase SLA, and provenance.

## 5. Network and lifecycle safety

- [ ] 5.1 Create child change `add-proxy-udp-quic-webrtc-policy` after 1.1/3.2; implement the state machine and verify proxy/auth/protocol matrices prove UDP failure blocks WebRTC, QUIC uncertainty disables QUIC, credentials are protected, and no direct fallback packets occur.
- [ ] 5.2 Record p0f proxy infrastructure as a separate deferred proposal, not a dependency of 5.1; verify the Windows release plan contains no p0f acceptance claim.
- [ ] 5.3 Create child change `add-disposable-profiles` after 3.1/5.1; verify isolated ownership and cleanup on normal exit, kill, launcher crash, engine crash, and host restart without touching persistent/exported data.

## 6. Public automation surfaces

- [ ] 6.1 Use the clone-signed first-wave corpus as the API baseline; do not wait for Phase B Chromium characterization before removal or later API planning.
- [ ] 6.2 Create child change `add-standalone-node-python-sdks` after 6.1; publish independently versioned Node and Python SDKs and verify package, type, auth, error, and V1/V2 conformance suites; do not add Rust.
- [ ] 6.3 Create and approve child `add-constrained-mcp-server` after 6.1/6.2; implement only enumerated typed tools, stdio default, optional loopback HTTP, 15-minute audience-bound scopes, RBAC/revocation/replay/rate-limit/denial tests, redaction, and tamper-evident retention; prohibit generic process/filesystem/arbitrary-network/credential, unbounded evaluate/script, and raw CDP primitives under every scope.

## 7. Privacy and gated research

- [ ] 7.1 Add opt-in telemetry/redaction requirements to each affected child slice; verify disabled-by-default behavior, unknown-key denial, prohibited-field fixtures, retention, export, and deletion controls.
- [ ] 7.2 Create research-only child change `evaluate-google-widevine-surfaces` after 1.3; verify legal/protocol approvals are recorded before experiments and that no result can silently enter production or weaken release gates.

## 8. Windows promotion and rollback

- [ ] 8.1 Integrate completed Windows child changes only through their versioned contracts; verify strict CI, two-repo conformance, API/SDK/MCP suites, network leakage tests, crash cleanup, runtime tamper tests, and catalog coherence all pass.
- [ ] 8.2 Run preview and beta rollback rehearsals, then collect dated clean-VM evidence and Authenticode verification; verify stable promotion is blocked by any unresolved requirement.

## 9. Later host support

- [ ] 9.1 After Windows contract stabilization, create child change `add-linux-host-support`; verify host-specific runtime trust, secrets, packaging, process cleanup, and checker evidence without weakening shared contracts.
- [ ] 9.2 After Linux portability review, create child change `add-macos-host-support`; verify notarization/signing, Keychain integration, packaging, cleanup, and checker evidence without weakening shared contracts.

## 10. Program closure

- [ ] 10.1 Confirm every implementation commit belongs to a bounded child OpenSpec change and feature branch; verify this umbrella contains no production implementation and no child was delivered as a monolith.
- [ ] 10.2 Reconcile child evidence into a release traceability matrix mapping every normative scenario to deterministic CI, clean-VM evidence, legal approval, or explicit deferral; verify no requirement is unowned or marked passed without evidence.
- [ ] 10.3 Archive/sync implementation children independently in dependency order; archive this governance umbrella last only after all non-deferred children complete, or explicitly supersede it through an approved governance change.
