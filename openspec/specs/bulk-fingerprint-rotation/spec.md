# bulk-fingerprint-rotation Specification

## Purpose
Defines mass fingerprint maintenance across profiles: coherent rotate and targeted patch modes with per-item validation, atomic persistence, and fail-closed handling of running profiles.

## Requirements

### Requirement: Coherence-gated rotation
Every fingerprint persisted by bulk rotation MUST pass the `FingerprintCoherenceValidator` before write; incoherent results MUST be rejected per-item with the validator issue list and MUST NOT be persisted.

#### Scenario: Incoherent patch rejected per-item
- **GIVEN** a patch setting a macOS user-agent on a profile with Windows font inventory
- **WHEN** bulk-fingerprint runs in `patch` mode
- **THEN** that item MUST be reported with `ok: false` and the coherence issue list, its stored fingerprint MUST be unchanged, and other items MUST still persist

### Requirement: Running profiles never mutate mid-session
Profiles with a running browser MUST be skipped by bulk fingerprint operations and reported with an explicit running error.

#### Scenario: Running profile skipped in batch
- **GIVEN** a batch containing two stopped profiles and one running profile
- **WHEN** bulk-fingerprint executes
- **THEN** the running profile MUST be reported `ok: false, error: "running"` with its fingerprint unchanged, and the stopped profiles MUST be rotated

### Requirement: Deterministic rotate with seed hint
Bulk rotation MUST be replayable: the same `seed_hint` and profile id MUST produce the same rotated fingerprint across repeated invocations.

#### Scenario: Replay produces identical results
- **GIVEN** profile P and `seed_hint: 42`
- **WHEN** executing the same rotate request twice
- **THEN** both executions MUST persist identical fingerprint seeds and configs for P

### Requirement: Per-item atomic writes
Each profile update MUST be independently atomic; a failure of one item MUST NOT abort or corrupt the remainder of the batch.

#### Scenario: Middle-item failure leaves siblings persisted
- **GIVEN** a three-profile batch where item 2 fails coherence validation
- **WHEN** the batch completes
- **THEN** items 1 and 3 MUST have their new fingerprints persisted and item 2 MUST retain its previous fingerprint
