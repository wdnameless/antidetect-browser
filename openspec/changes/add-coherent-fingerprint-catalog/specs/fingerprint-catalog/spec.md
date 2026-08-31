## Purpose

Defines the curated 30-family Windows fingerprint catalog, positive signed int32 seed space, domain-separated sub-seed derivation, cross-surface coherence invariants, and legacy seed migration.

## ADDED Requirements

### Requirement: Curated catalog integrity and weight normalization
The fingerprint subsystem MUST provide a curated catalog of exactly 30 Windows hardware families with normalized weights summing to 1.0.

#### Scenario: Catalog size and weight sum
- **GIVEN** the fingerprint catalog definition in `src/main/fingerprints/catalog.ts`
- **WHEN** inspecting the family collection
- **THEN** it MUST contain exactly 30 entries and the sum of all family weights MUST equal `1.000000` (+/- 0.000001)

### Requirement: Positive signed int32 seed derivation
Profile fingerprints MUST derive all subsystem sub-seeds deterministically from a positive signed 32-bit integer (`1..2147483647`).

#### Scenario: Domain-separated sub-seed generation
- **GIVEN** a primary profile seed `123456789`
- **WHEN** deriving sub-seeds for canvas, audio, and webgl
- **THEN** each derived sub-seed MUST be distinct, reproducible, and bound to its domain label

### Requirement: Cross-surface coherence invariants
A generated profile fingerprint MUST satisfy realistic hardware and software correlations across all exposed browser dimensions.

#### Scenario: GPU, CPU, and RAM coherence check
- **GIVEN** a catalog family representing an integrated graphics laptop (e.g. Intel Iris Xe)
- **WHEN** inspecting its hardware properties
- **THEN** CPU core count MUST NOT exceed 14 cores, RAM MUST NOT exceed 32 GB, and screen color depth MUST match standard sRGB

### Requirement: Deterministic legacy seed migration
Profiles with invalid, negative, or missing seeds MUST be migrated to the positive signed int32 space deterministically without random drift.

#### Scenario: Migrating legacy seed zero
- **GIVEN** an existing profile record with seed `0`
- **WHEN** the profile is loaded or migrated
- **THEN** it MUST receive a deterministic positive seed derived from its profile ID hash and NEVER pick a random value on subsequent launches
