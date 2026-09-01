## Purpose

Defines reproducible baseline, release evidence, claim, privacy, and hygiene gates that must pass before any Windows stealth-parity release can be promoted.

## ADDED Requirements

### Requirement: Ordered legacy and Chromium baselines
After separate approval of both children, baseline MUST create a fully isolated disposable clone of the pre-denial executable/build, DB, and profile filesystem. All mutating Firefox fixtures MUST run only in that clone. It MUST emit verified `LEGACY_CORPUS_SIGNED` before production denial/removal; Chromium characterization MAY continue afterward without blocking removal.

#### Scenario: Negative input - conflicting corpus observation
- **WHEN** identical fixture IDs produce different status/body/side effects
- **THEN** signing MUST fail and removal deletion MUST remain blocked

#### Scenario: State or race - removal waits only for corpus barrier
- **WHEN** disable and capture overlap
- **THEN** production behavior MUST remain unchanged, mutating fixtures MUST stay clone-only, and denial/removal MUST wait for verified published `LEGACY_CORPUS_SIGNED` but MUST NOT wait for Phase B

#### Scenario: Boundary or null - no legacy rows
- **WHEN** the snapshot contains no Firefox rows
- **THEN** field/route fixtures MUST still run and record valid zero-state behavior

#### Scenario: Auth or permission - corpus signer
- **WHEN** an untrusted CI identity attempts to sign the corpus
- **THEN** verification MUST fail and the barrier MUST remain closed

### Requirement: Verifiable legacy corpus envelope
Corpus bytes MUST be RFC 8785 JCS UTF-8 and SHA-256 addressed. Ed25519 MUST sign the domain-separated canonical envelope with every field defined in design.md. The trusted key ID MUST resolve from the pinned public-key ring. Publication MUST be immutable/content-addressed, and verifier MUST fail closed on digest, signature, key, schema, provenance, address, or replay mismatch.

#### Scenario: Envelope replay or mismatch
- **WHEN** an envelope is replayed for a different source build or any signed field/digest differs
- **THEN** verification MUST fail and production denial MUST remain blocked

### Requirement: Fail-closed machine release policy
Stable promotion MUST use the pinned machine-readable policy and signed evidence schema from design.md. Required checks with fail, unresolved, quarantined, unavailable, stale, unsigned, or tampered states MUST block stable. Every gate MUST emit canonical machine-readable pass/fail summary and nonzero on non-pass.

#### Scenario: Negative input - tampered evidence
- **WHEN** any evidence digest or signature is invalid
- **THEN** stable promotion MUST fail

#### Scenario: State or race - concurrent evidence upload
- **WHEN** two workers publish the same assertion set
- **THEN** evidence indexing MUST deduplicate identical digests and reject conflicting results

#### Scenario: Boundary or null - missing threshold
- **WHEN** a numeric assertion omits threshold or sampling rule
- **THEN** policy validation MUST fail rather than infer a pass

#### Scenario: Auth or permission - unauthorized policy downgrade
- **WHEN** a caller lacking release-policy scope lowers sequence or removes a required assertion
- **THEN** the policy MUST be rejected and audited

### Requirement: Evidence privacy hygiene and claims
Release evidence and repository/package artifacts MUST contain no prohibited sensitive fields or stable cross-session identifiers. Opt-in withdrawal, retention, export, and deletion MUST be testable. Claims MUST identify tested versions/date/matrix/limitations and MUST NOT claim undetectability.

#### Scenario: Negative input - secret in crash dump
- **WHEN** the privacy scanner detects a secret, proxy credential, URL, cookie, page data, or stable identifier in logs/dumps/checker artifacts
- **THEN** signing and stable promotion MUST fail

#### Scenario: State or race - consent withdrawal during collection
- **WHEN** telemetry consent is withdrawn during artifact collection
- **THEN** future collection MUST stop immediately and queued subject data MUST follow deletion policy

#### Scenario: Boundary or null - unknown artifact field
- **WHEN** an evidence payload includes an unrecognized field
- **THEN** deny-by-default serialization MUST reject it

#### Scenario: Auth or permission - evidence export
- **WHEN** a caller lacks subject-export permission
- **THEN** export MUST be denied without disclosing subject existence

#### Scenario: Unsupported claim
- **WHEN** docs or UI claim undetectability or omit evidence limitations
- **THEN** the claims gate MUST fail
