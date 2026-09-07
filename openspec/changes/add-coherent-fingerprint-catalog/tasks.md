## 1. Catalog Schema and Dataset

- [x] 1.1 Define TypeScript schemas and validation contracts for Archetype Definitions (`src/shared/types/fingerprint-catalog.ts`).
- [x] 1.2 Collect and curate empirical hardware baselines for Windows 10/11 (Intel, AMD, NVIDIA GPUs).
- [x] 1.3 Collect and curate empirical hardware baselines for macOS (Intel and Apple Silicon M1-M4 series).
- [x] 1.4 Collect and curate empirical hardware baselines for Linux desktop environments.
- [ ] 1.5 Package catalog entries into compressed data bundle (`assets/fingerprints/catalog-v2.json`).

## 2. Coherence Validation Engine

- [x] 2.1 Implement `FingerprintCoherenceValidator` core engine with rule-based subsystem checks.
- [x] 2.2 Implement OS-GPU and WebGL extension coherence assertions.
- [x] 2.3 Implement Display dimensions, DPR, and orientation consistency checks.
- [ ] 2.4 Implement AudioContext and OS audio stack correlation checks.
- [x] 2.5 Implement Font list and OS platform consistency checks.
- [x] 2.6 Implement User-Agent and Client Hints high-entropy coherence rules.

## 3. Profile Generation & Runtime Integration

- [ ] 3.1 Update profile generation service to sample coherent archetypes instead of uncorrelated random values.
- [x] 3.2 Wire `FingerprintCoherenceValidator` into profile preflight checks and profile save handlers.
- [x] 3.3 Add coherence score and issue diagnostic breakdown to Profile Diagnostics UI.
- [x] 3.4 Create comprehensive automated test suite in `tests/fingerprint/coherence.test.ts` verifying all consistency rules.
- [x] 3.5 Run `openspec validate add-coherent-fingerprint-catalog --strict` and verify compliance.
