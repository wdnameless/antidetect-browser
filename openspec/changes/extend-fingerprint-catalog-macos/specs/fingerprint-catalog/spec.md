## ADDED Requirements

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
