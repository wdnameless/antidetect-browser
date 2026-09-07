## 1. Rotation service and endpoint

- [ ] 1.1 Implement `rotateFingerprints(userIds, mode, patch?, seedHint?)` in `src/main/profiles/profileManager.ts`: coherent-catalog sampling for `rotate`, targeted patch for `patch`, per-item coherence validation and atomic persist; unit tests for all rules from the design.
- [ ] 1.2 Add `POST /api/v1/browser-profile/bulk-fingerprint` route in `batch.ts` with zod body validation and per-item report; route tests (auth, shape, error mapping).
- [ ] 1.3 Bulk bar "Rotate fingerprints" action in Profiles.tsx with mode picker (rotate/patch) and result toasts; component-level check via existing UI test approach.

## 2. Verification

- [ ] 2.1 Update CHANGELOG; full vitest suite (601 baseline + new) + typecheck green; `openspec validate add-bulk-fingerprint-rotation --strict`.