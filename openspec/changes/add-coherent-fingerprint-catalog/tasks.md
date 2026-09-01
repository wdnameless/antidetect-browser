## 1. Catalog schema and 30 curated families

- [x] 1.1 Define TypeScript schemas and types for `FingerprintCatalogFamily` and coherence validation in `src/main/fingerprints/types.ts`.
- [x] 1.2 Author all 30 curated Windows hardware/software families with source citations and normalized weights in `src/main/fingerprints/catalog.ts`.

## 2. Seed derivation and coherence engine

- [x] 2.1 Implement domain-separated sub-seed derivation (HMAC-SHA256) in `src/main/fingerprints/derivation.ts`.
- [x] 2.2 Implement invariant verification suite asserting GPU/CPU/RAM/Screen/Font coherence for every catalog family.
- [x] 2.3 Implement legacy seed migration function guaranteeing positive int32 output and reproducible replay.

## 3. Integration with ProfileManager and StealthInjection

- [x] 3.1 Refactor `src/main/profiles/profileManager.ts` to resolve profile hardware and user-agent from catalog seeds.
- [x] 3.2 Update `src/main/proxy/stealthInjection.ts` to ingest catalog-derived parameters instead of hardcoded constants.

## 4. Testing and validation

- [x] 4.1 Unit tests for seed derivation, catalog weight sum normalization (`sum == 1.0`), and deterministic legacy migrations in `tests/unit/fingerprints/`.
- [x] 4.2 Run `openspec validate add-coherent-fingerprint-catalog --strict` and verify compliance.
