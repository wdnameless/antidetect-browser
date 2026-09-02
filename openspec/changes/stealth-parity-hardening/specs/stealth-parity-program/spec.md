## Purpose

Defines measurable safety, compatibility, privacy, trust, and release contracts for phased stealth-parity delivery across public and private components.

## ADDED Requirements

### Requirement: Phased bounded delivery
The program SHALL ship Windows first and MUST implement every program slice through a bounded child OpenSpec change and dedicated feature branch; the umbrella MUST NOT authorize monolithic implementation. Linux MUST follow Windows contract stabilization, and macOS MUST follow the Linux portability review.

#### Scenario: Attempted umbrella implementation
- **GIVEN** the umbrella artifacts are approved
- **WHEN** implementation is requested without a bounded child change
- **THEN** implementation MUST be blocked and the required child change MUST be identified

### Requirement: Deterministic release evidence
Every Windows stable candidate MUST pass strict deterministic CI and MUST attach dated results from the approved external-checker matrix on a freshly reset Windows VM. Every gate MUST return nonzero for a failed assertion, and a volatile or unavailable checker MUST be reported as unresolved or quarantined rather than passed.

#### Scenario: WebRTC leakage is detected
- **GIVEN** a candidate is evaluated in CI
- **WHEN** any WebRTC assertion detects a direct or unexpected path
- **THEN** the gate MUST exit nonzero and stable promotion MUST be blocked

### Requirement: Camoufox removal preserves data
After both child approvals, isolated clone creation, clone-only mutating corpus capture, and verified publication of `LEGACY_CORPUS_SIGNED`, the product MUST deny production Camoufox writes and then remove selection/launch paths. Production behavior MUST remain unchanged during clone corpus capture. Silent conversion is prohibited and raw data is preserved indefinitely until authenticated explicit cleanup.

#### Scenario: Existing Camoufox profile is opened
- **GIVEN** an existing Camoufox-managed profile
- **WHEN** a user attempts to launch it after removal
- **THEN** launch MUST be refused with an actionable preservation/export message and no raw profile data MUST be changed

### Requirement: Trusted immutable runtime
The launcher MUST install only runtime artifacts whose canonical immutable manifest, SHA-256 digest, Ed25519 signature, platform, compatibility range, and SBOM digest validate against the bundled public trust contract. Installation MUST be atomic, preserve last-known-good rollback, and public Windows stable releases MUST also carry valid Authenticode signatures.

#### Scenario: Runtime artifact is modified
- **GIVEN** a signed runtime manifest
- **WHEN** downloaded artifact bytes do not match the declared SHA-256 digest
- **THEN** installation MUST stop, the active runtime MUST remain unchanged, and a tamper event without sensitive data MUST be recorded

### Requirement: Public-private engine boundary
The public repository SHALL expose only the versioned capability contract, verification public key, signed-manifest integration, compatibility rules, and non-secret conformance fixtures. The private repository MUST own the narrow `fingerprint-chromium` patch-set and build/signing chain for WebGPU, UA-CH/GREASE, fonts, voices, screen cap, battery/storage/heap/media devices, color gamut/HDR, WebAuthn, CDP/V8 side channels, TLS ClientHello/JA4, and deterministic Canvas/Audio/DOMRect behavior. Engine-owned surfaces MUST NOT depend on JavaScript spoofing.

#### Scenario: Required engine capability is absent
- **GIVEN** a launcher and runtime negotiate capabilities
- **WHEN** a required capability or compatible schema version is absent
- **THEN** the runtime MUST be rejected before profile launch with the missing capability identified

### Requirement: Coherent curated fingerprint catalog
The Windows catalog MUST contain exactly 30 synthetic curated profile families from dated legally usable public/OEM/market sources and MUST NOT use telemetry-collected device fingerprints. Published vectors MUST use positive signed int32 seeds `1..2147483647`. The future child MUST replay frozen compatibility behavior for legacy zero, negative, minimum, and maximum values; zero/negative values MUST be deterministically migrated or rejected, never silently randomized or published. Each profile MUST satisfy cross-surface and engine/catalog compatibility constraints.

#### Scenario: Cross-context inconsistency
- **GIVEN** a catalog profile and fixed seed
- **WHEN** main frame, iframe, worker, service worker, extension world, CDP/V8, and network observations are compared
- **THEN** every declared invariant MUST match or the profile family MUST fail catalog admission

### Requirement: Fail-closed proxy transport policy
The system MUST probe proxy UDP support before permitting WebRTC and MUST block WebRTC when UDP support fails or is ambiguous. It MUST auto-probe QUIC through the authenticated proxy path and force-disable QUIC unless that probe succeeds. It MUST never fall back to a direct WebRTC or QUIC path.

#### Scenario: Proxy lacks UDP support
- **GIVEN** a profile configured with a proxy
- **WHEN** UDP probing fails, times out, or is inconclusive
- **THEN** WebRTC MUST be blocked, QUIC MUST be disabled unless separately proven through the proxy, and no direct packet MUST be emitted

### Requirement: Disposable profile cleanup
Temporary profiles MUST use an isolated lifecycle identity and MUST be scheduled for fail-safe cleanup after normal exit, forced termination, launcher crash, or host restart, without deleting persistent profiles or user-designated exports.

#### Scenario: Launcher crashes with temporary profile active
- **GIVEN** an active disposable profile
- **WHEN** the launcher terminates unexpectedly
- **THEN** the next recovery pass MUST terminate orphaned runtime processes and remove only lifecycle-owned temporary data

### Requirement: Compatible standalone SDKs
The program MUST publish standalone Node and Python SDKs generated or validated against versioned OpenAPI and MUST run conformance suites against AdsPower V1 and V2. It MUST NOT introduce breaking route, field, default, auth, or status-semantic changes to either AdsPower API and MUST NOT include a Rust SDK in this program.

#### Scenario: Existing V1 client is replayed
- **GIVEN** a recorded valid AdsPower V1 interaction corpus
- **WHEN** it is replayed against a candidate release
- **THEN** response status, required fields, defaults, and externally visible semantics MUST remain compatible

### Requirement: Constrained MCP permissions
The MCP server MUST permit only the typed tools enumerated in design.md. Generic process, filesystem, arbitrary-network, credential-retrieval, unbounded evaluate/script, and raw CDP primitives MUST be prohibited under every scope. Separately gated typed destructive/sensitive tools MUST require RBAC, explicit scope, confirmation where applicable, denial tests, redaction, and tamper-evident audit.

#### Scenario: MCP requests arbitrary process execution
- **GIVEN** a default MCP session
- **WHEN** a client requests arbitrary process execution
- **THEN** the server MUST deny the request without execution and MUST emit a redacted authorization audit event

#### Scenario: Elevated scope requests raw CDP
- **WHEN** any credential requests raw CDP or caller-supplied script execution
- **THEN** the request MUST be denied and audited because no scope can enable prohibited primitives

### Requirement: Deterministic network actions
Every state MUST map exactly: healthy `NO_PROXY` permits direct launch; fully passing `SOCKS5_UDP` permits proxy-bound launch; TCP-only SOCKS5/HTTP/HTTPS/SSH permits constrained launch with WebRTC/QUIC blocked. Prelaunch TCP-, auth-, or proxy-DNS-stage failure or exhausted stage retry refuses launch. UDP_ASSOCIATE- or STUN-stage failure/exhaustion permits constrained launch with WebRTC/QUIC blocked. QUIC-stage failure/exhaustion permits launch with QUIC disabled and WebRTC only after UDP/STUN pass. Valid cache hit reuses the exact result; expiry reprobes; concurrent probes single-flight. Host-network/proxy-config change and runtime TCP loss, auth revocation, proxy-DNS loss, or UDP/STUN loss immediately terminate affected proxied browsers and mark capability stale. QUIC-only runtime loss also immediately terminates and marks QUIC stale. Browser crash clears ownership and requires cleanup/restart. Proxied profiles MUST never direct-fallback.

#### Scenario: Mid-session UDP loss
- **WHEN** an active proxied browser loses validated UDP
- **THEN** it MUST terminate immediately with WebRTC blocked and QUIC disabled until explicit reprobe/restart

#### Scenario: Concurrent probe
- **WHEN** launches share a probe cache key
- **THEN** one probe MUST run and all waiters MUST receive that result or deterministic timeout failure

### Requirement: Governance ownership and archive order
This umbrella MUST own only `stealth-parity-program`. Product deltas MUST be owned by separately approved implementation children that archive or sync independently. The umbrella MUST archive last after every non-deferred child completes or MUST be explicitly superseded.

#### Scenario: Premature umbrella archive
- **WHEN** any non-deferred child is incomplete
- **THEN** umbrella archive MUST be blocked

### Requirement: Legally gated research surfaces
Widevine and Google validation-header work MUST remain a non-production research slice until legal and protocol review explicitly approves its scope, evidence, distribution, and rollback. Research failure MUST NOT weaken other release gates.

#### Scenario: Legal approval is absent
- **GIVEN** a candidate contains Widevine or validation-header behavior
- **WHEN** no recorded legal/protocol approval exists
- **THEN** production packaging and release MUST be blocked for that behavior

### Requirement: Privacy-first telemetry
Telemetry MUST be disabled by default and MUST require explicit opt-in. Telemetry serialization MUST be allowlist-based and MUST exclude URLs, page data, cookies, storage contents, proxy credentials, secrets, and raw device fingerprints; retention and deletion controls MUST be documented and testable.

#### Scenario: Prohibited field reaches telemetry boundary
- **GIVEN** telemetry is opted in
- **WHEN** an event includes a prohibited field or unknown payload key
- **THEN** serialization MUST reject or redact it before persistence or transmission and a non-sensitive validation metric MUST be recorded

### Requirement: Reversible release and compatibility
Each slice MUST have an independent capability gate and rollback procedure. Rollback MUST restore the last-known-good runtime/catalog atomically, apply fail-closed network policy, preserve user data, and maintain AdsPower V1/V2 availability.

#### Scenario: Post-install health check fails
- **GIVEN** a newly staged signed runtime
- **WHEN** its post-install health check fails
- **THEN** activation MUST be aborted or reverted to last-known-good without changing AdsPower compatibility or deleting user profiles
