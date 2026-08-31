## Context

The Windows-only app uses Electron/React/Express/SQLite, AdsPower V1/V2 APIs, `fingerprint-chromium` 148, seed flags, and MV3 injection. It lacks enforceable WebGPU, TLS/QUIC, native voices, WebAuthn, and several engine-owned surfaces; runtime downloads lack digest/signature verification; Camoufox management is incomplete; manual checkers are not CI gates; the WebRTC script always exits zero; and no native MCP or published standalone SDKs exist. Stronger foundations already exist in DPAPI/AES secrets, host controls, teams/RBAC/E2E sync, Action Syncer, Scripts, and server mode.

Dated public ShardX repository observations report a Tauri launcher, local bearer API, UDP_ASSOCIATE/STUN probing, disposable profiles, OpenAPI, Node/Python/Rust SDKs, and MCP. They are design inputs only, not trusted acceptance evidence; any citation MUST include repository path/URL and observed date, and closed-engine claims remain unverified. This design rejects unsigned mutable runtimes, plaintext proxy credentials, weak tests, disabled CSP, decade-long tokens, and unscoped MCP.

## Goals / Non-Goals

**Goals:** preserve vertical-slice autonomy; make release evidence deterministic and auditable; keep public/private boundaries narrow; fail closed on runtime and network uncertainty; preserve API/data compatibility.

**Non-Goals:** a monolithic rewrite; public engine source; p0f infrastructure; Rust SDK; telemetry-derived device profiles; silent Camoufox migration; uncontrolled Widevine/header experimentation.

## Decisions

### 1. Program and vertical-slice boundaries

The umbrella is decomposed into bounded child changes: `establish-parity-baseline`; `remove-camoufox-engine`; `secure-runtime-supply-chain`; `add-coherent-fingerprint-catalog`; private-repo `patch-engine-identity-graphics`, `patch-engine-environment-surfaces`, `patch-engine-deterministic-signals`, and `patch-engine-automation-tls`; then the remaining network, disposable-profile, SDK, MCP, research, Linux, and macOS children. Each slice requires independent approval and owns its contracts, tests, migration, and branch.

### 2. Dependency graph and release trains

Universal first-wave order is: both child approvals; isolated clone from pre-denial executable/build, DB, and profile filesystem; mutating Firefox fixtures only inside that clone while production behavior remains unchanged; canonicalize/sign/verify/publish `LEGACY_CORPUS_SIGNED`; only then deny production Firefox writes; remove product paths; and independently continue baseline Phase B Chromium characterization. Later dependencies: runtime trust and capability schema precede engine distribution; catalog precedes identity/graphics; `patch-engine-identity-graphics` depends on runtime trust, schema, and catalog; environment and deterministic-signal children depend on identity/graphics; automation/TLS depends on all three. Every private child remains private-repo bounded and separately approved.

### 3. Public/private repository contract

The public repository contains a versioned capability schema, supported engine/runtime identifiers, minimum launcher version, artifact coordinates, SHA-256 digests, Ed25519 signature metadata, SBOM reference/digest, public verification key, compatibility policy, and integration tests using non-secret fixtures. The private repository owns patches, build recipes, provenance, signing operation, and engine conformance evidence. A manifest is accepted only when schema version, engine ABI, launcher range, artifact digest, SBOM digest, and signature all validate. Alternative rejected: publishing patch internals or embedding private build credentials in the launcher.

### 4. Capability schema

Each runtime declares immutable identifiers and typed states for engine surfaces, network transports, profile schema, host OS/arch, API compatibility, evidence-suite version, and experimental legal gates. Unknown required fields are incompatible; unknown optional fields are ignored only under declared forward-compatibility rules. Capability negotiation is recorded without URLs, page data, cookies, or credentials.

### 5. Runtime trust chain

Release CI creates reproducible artifacts, CycloneDX/SPDX SBOM, SHA-256 digests, and an RFC 8785 JCS manifest. Ed25519 signs the exact UTF-8 JCS bytes containing schema, monotonic sequence, issued/expiry UTC, artifact/SBOM digests, compatibility, and key ID; detached transport metadata is not signed. The launcher rejects expired, future-issued, replayed, lower-sequence, revoked-key, or locally rolled-back manifests. A bundled root key ring supports threshold-approved add/retire/revoke/recovery statements; local accepted-sequence and last-known-good state are integrity protected. Same-volume staging uses a crash journal, fsync/close, atomic rename, health check, locked-file reboot recovery, and rollback rehearsal. Authenticode is required for installer, launcher executable, engine executable, and every shipped PE/DLL; subject allowlist, trusted chain, online/offline revocation policy, and RFC3161 timestamp-at-signing validation are mandatory.

### 6. Network state/action table

Network policy is evaluated before process launch. The deterministic table is authoritative:

| Event/state | Launch | WebRTC | QUIC | Action |
|---|---|---|---|---|
| NO_PROXY healthy | allowed | direct allowed and labeled | enabled after host check | launch |
| SOCKS5_UDP with auth, TCP, proxy-DNS, UDP_ASSOCIATE, STUN IPv4/IPv6 pass | allowed | proxy-bound only | enabled only after proxy QUIC pass | launch |
| SOCKS5_TCP_ONLY | allowed | blocked | disabled | constrained launch |
| HTTP, HTTPS, SSH | allowed | blocked | disabled | constrained launch |
| auth failure | refused | blocked | disabled | refuse |
| TCP failure | refused | blocked | disabled | refuse |
| proxy-DNS failure | refused | blocked | disabled | refuse |
| UDP_ASSOCIATE failure | allowed | blocked | disabled | constrained launch |
| STUN failure | allowed | blocked | disabled | constrained launch |
| QUIC probe failure | allowed | proxy-bound only if UDP/STUN passed | disabled | constrained launch |
| TCP-stage timeout plus one retry exhausted | refused | blocked | disabled | refuse |
| auth-stage timeout plus one retry exhausted | refused | blocked | disabled | refuse |
| proxy-DNS-stage timeout plus one retry exhausted | refused | blocked | disabled | refuse |
| UDP_ASSOCIATE-stage timeout plus one retry exhausted | allowed | blocked | disabled | constrained launch |
| STUN-stage timeout plus one retry exhausted | allowed | blocked | disabled | constrained launch |
| QUIC-stage timeout plus one retry exhausted | allowed | proxy-bound only if UDP/STUN passed | disabled | constrained launch |
| valid cache hit | prior result | prior result | prior result | reuse |
| cache expiry | pending | blocked | disabled | reprobe before launch |
| host-network change | n/a | blocked | disabled | terminate affected proxied browser immediately; mark stale; explicit reprobe/restart |
| proxy-config change | n/a | blocked | disabled | terminate affected proxied browser immediately; mark stale; explicit reprobe/restart |
| concurrent probe | pending | blocked | disabled | single-flight dedupe; deterministic wait/timeout |
| browser crash | refused until cleanup | blocked | disabled | clear ownership; cleanup; explicit restart |
| mid-session TCP loss | n/a | blocked | disabled | terminate immediately; mark stale; explicit reprobe/restart |
| mid-session auth revocation | n/a | blocked | disabled | terminate immediately; mark stale; explicit reprobe/restart |
| mid-session proxy-DNS loss | n/a | blocked | disabled | terminate immediately; mark stale; explicit reprobe/restart |
| mid-session UDP_ASSOCIATE or STUN loss | n/a | blocked | disabled | terminate immediately; mark stale; explicit reprobe/restart |
| mid-session QUIC-only loss | n/a | unchanged proxy-bound state | disabled | terminate immediately; mark QUIC stale; explicit reprobe/restart |

Configured proxies never direct-fall-back. Cache key is HMAC(endpoint, protocol, username identifier, credential-version, interface/gateway, DNS mode), excludes raw credentials, has maximum 10-minute TTL, and invalidates on listed changes. Probe timeout is 5 seconds plus one jittered retry. Acceptance requires packet capture and Windows firewall evidence plus browser ICE.

### 7. Profile coherence model

The versioned catalog contains exactly 30 curated Windows families from dated, legally usable public/OEM/market sources with citation path/URL, terms review, observed date, caveat, and normalized weights summing to 1.0. Weights drive deterministic selection, not population claims. Published vectors use positive signed int32 seeds `1..2147483647`. The future child MUST replay frozen API behavior for legacy zero, negative, `-2147483648`, and `2147483647`; zero/negative values are deterministically migrated or rejected per corpus, never silently randomized or published. Domain-separated sub-seeds, collision handling, invalid-combination rejection, and engine/catalog compatibility gates are mandatory. These are synthetic curated families, not captured real devices.

### 8. Validation and evidence architecture

Strict CI uses a signed machine-readable release policy pinning Windows image/toolchain/checker versions and digests, commands, assertions, thresholds, retry/timeout rules, and required status. Every gate emits canonical JSON pass/fail/unresolved summaries with policy/candidate/tool/VM digests and evidence provenance. Stable candidates require signed dated clean-VM evidence retained at least 24 months and two stable-release lifetimes. Any unresolved, quarantined, unavailable, stale, unsigned, tampered, or threshold-failing required check blocks stable. Packet capture/firewall evidence is mandatory for network claims; browser ICE alone is insufficient.

### 9. API compatibility and automation

AdsPower behavior is frozen by child-owned corpora before legacy deletion. MCP defaults to stdio; optional HTTP binds loopback only. Allowed defaults are `profiles.list|get|create|start|stop`, `browser.navigate|click|type|screenshot`, and `diagnostics.run`. Separately gated typed tools are `profiles.delete|restore|export_preserved|cleanup_preserved` and server-allowlist-ID-only `browser.evaluate_allowlisted`. Generic process, filesystem, arbitrary-network, credential-retrieval, unbounded evaluate/script, and raw CDP primitives are prohibited under every scope. Fifteen-minute credentials bind audience/client/scopes/tenant and enforce nonce replay defense, revocation, RBAC, rate limits, denial tests, redaction, and hash-chained audit retention for 24 months.

### 10. Privacy and telemetry

Telemetry is disabled by default and requires explicit opt-in. Deny-by-default serialization excludes URLs, page/body data, cookies/storage, proxy credentials, secrets, raw fingerprints, crash-dump sensitive memory, logs/checker raw payloads, MCP arguments/results, and stable cross-session identifiers. Consent withdrawal stops future collection immediately; pseudonymous subject data supports documented retention, authenticated export, and deletion while aggregate signed release attestations remain non-identifying.

### 11. Private engine surface groups and security maintenance

Private engine work is split only into `patch-engine-identity-graphics`, `patch-engine-environment-surfaces`, `patch-engine-deterministic-signals`, and `patch-engine-automation-tls`; each has independent approval, per-surface assertions, provenance, rollback, and public capability flags. Dependencies are identity/graphics after runtime/schema/catalog; environment and deterministic signals after identity/graphics; automation/TLS after all three. Every build pins exact upstream fingerprint-chromium commit and source/artifact SHA-256, records patch digest/license review, and meets the Chromium security-rebase SLA.

### 12. Secret storage and sync verification

Future child `harden-local-secret-storage` makes Windows secret writes fail closed if DPAPI is unavailable, transactionally migrates legacy/plain values with rollback, validates owner/system-only ACLs, defines encrypted backup/key rotation, permits compatible plaintext reads only during a dated migration window, and proves secrets absent from logs, manifests, telemetry, cache keys, dumps, and plaintext storage. Future child `harden-sync-server-verification` supplies missing server tests and auth/RBAC/rate-limit/host-allowlist/E2E-sync security gates. Both require full child drafts and user approval.

### 13. Source classification and archive order

ShardX observations are dated public-source inputs only and, if cited, include repository path/URL and observed date. They are not acceptance evidence; closed-engine claims remain unverified. Implementation children archive or sync independently in dependency order and own product deltas. This umbrella archives last only after all non-deferred children complete, or is explicitly superseded by an approved governance change.

## Risks / Trade-offs

- [Public/private contract drift] -> schema conformance and two-repo release gating.
- [Signing key compromise] -> offline/HSM custody, rotation metadata, revocation, and last-known-good rollback.
- [External checker instability] -> pinned dated matrix, clean VM evidence, quarantine, and human disposition.
- [Coherence errors across many surfaces] -> generated constraint validation and cross-context differential tests.
- [Proxy claims cannot be proven] -> fail closed for WebRTC and QUIC; never direct fallback.
- [Removal strands Camoufox users] -> removal only after clone corpus barrier, with indefinite registry preservation/export and explicit cleanup.
- [Closed engine reduces public reproducibility] -> publish capability contract, key, manifest, SBOM references, and black-box conformance evidence.

## Migration Plan

1. After both child approvals, baseline creates a fully isolated disposable clone of the pre-denial executable/build, DB, and profile filesystem and runs all mutating Firefox corpus fixtures only there.
2. After verified `LEGACY_CORPUS_SIGNED`, removal may deny production writes/remove paths while preserving registry data; baseline may continue Chromium characterization independently.
3. Introduce trusted runtime side-by-side; retain current runtime as last-known-good until health gates pass.
4. Roll catalog, network policy, engine patch-set, and disposable profiles behind independently reversible capability gates.
5. Publish OpenAPI and SDKs, then MCP with minimal default scopes.
6. Promote Windows preview -> beta -> stable only after strict CI, clean-VM evidence, Authenticode, and rollback rehearsal.
7. Start Linux and macOS child changes only after host-neutral contracts stabilize.

Rollback disables the affected capability, atomically restores last-known-good runtime/catalog, terminates disposable sessions, applies fail-closed network policy, and never deletes user data. AdsPower endpoints continue to operate throughout.
