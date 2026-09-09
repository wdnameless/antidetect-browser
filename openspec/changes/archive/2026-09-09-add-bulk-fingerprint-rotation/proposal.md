## Why

Afina ships bulk fingerprint updates (mass-rotate timezone/languages/CPU/RAM/component noise across many accounts). Our bulk endpoints cover start/stop/delete/group but not fingerprints — long-lived account fleets must be rotated one profile at a time.

## What Changes

- New endpoint `POST /api/v1/browser-profile/bulk-fingerprint` with body `{ user_ids: string[], mode: "rotate" | "patch", patch?: FingerprintPatch }`.
  - `rotate`: resamples a coherent catalog family for each profile (uses the coherent sampling from catalog task 3.1) and stores the new seed/config atomically.
  - `patch`: applies targeted field changes (timezone, languages, hardware, noise toggles) on top of the existing fingerprint.
- Per-item report `{ user_id, ok, error?, coherence? }` in the response, matching the existing bulk-endpoint contract shape (`bulk-start`/`bulk-stop` style).
- Running profiles are skipped and reported as `{ ok: false, error: "running" }` — never mutated mid-session.
- Every persisted result passes the `FingerprintCoherenceValidator` before write; incoherent results are rejected per-item with the validator's issue list.
- UI: bulk bar gains "Rotate fingerprints" action on selection.

## Capabilities

### New Capabilities
- `bulk-fingerprint-rotation`: rotate/patch modes, per-item coherence-gated persistence, running-profile skip.

### Modified Capabilities
- `fingerprint-catalog`: consume coherent sampling (task 3.1) as the rotation source.

## Impact

- `src/main/api/routes/batch.ts` (new route), `src/main/profiles/profileManager.ts` (rotation service function), `src/main/fingerprints/` (sampling consumption only), `src/renderer/src/pages/Profiles.tsx` (bulk bar action), tests in `tests/unit/bulkFingerprint.test.ts`.
- Atomic per-profile write via existing transactional profile update path; a failed item never blocks or corrupts siblings.