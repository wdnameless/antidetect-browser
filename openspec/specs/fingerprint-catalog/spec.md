# fingerprint-catalog Specification

## Purpose
Defines the curated 30-family Windows fingerprint catalog, positive signed int32 seed space, domain-separated sub-seed derivation, cross-surface coherence invariants, and legacy seed migration.

## Requirements

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

### Requirement: macOS device families
The catalog SHALL provide curated macOS families covering Apple silicon (M1, M2, M3, M4) and Intel Macs, each carrying per-chip GPU renderer, audio signature, font inventory, screen profile and scale factor. Families MUST be derived from documented public specifications; harvested or telemetry-sourced device fingerprints are forbidden.

#### Scenario: Family selection by chip
- **WHEN** a user creates a profile with OS=macOS and chip=M3
- **THEN** the assigned family carries an Apple M3-coherent WebGL renderer, audio signature, fonts and Retina screen profile

#### Scenario: Provenance recorded
- **WHEN** any family is inspected
- **THEN** a provenance note documents its public specification sources

### Requirement: Cross-property coherence validation
The system SHALL ship a CI-executed validator that verifies UA, UA-CH, platform, WebGL renderer, screen, fonts and audio coherence for every catalog family, failing the build on any mismatch.

#### Scenario: Incoherent family rejected
- **WHEN** a family pairs an Apple GPU renderer with a Windows UA
- **THEN** the validator fails with the incoherent field pair named

### Requirement: Windows 11 refresh with stability
The catalog SHALL add Windows 11 families reflecting current documented market distribution while keeping the existing 30 Windows families byte-stable for seeded reproducibility.

#### Scenario: Legacy family stability
- **WHEN** an existing profile created before this change is launched
- **THEN** its fingerprint outputs remain bit-identical to pre-change behavior
