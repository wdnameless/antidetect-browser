# Design: Bulk Fingerprint Rotation

## Context and Scope

Mass fingerprint maintenance for account fleets, built on the existing bulk-endpoint conventions (one request, per-item report) and the coherence validator.

## Key Decisions

1. **Two modes, one handler**: `rotate` resamples from the coherent catalog (requires `finish-fingerprint-catalog` task 3.1); `patch` mutates selected fields only. Both go through `FingerprintCoherenceValidator` before persist — an incoherent result (e.g. patching a macOS UA while keeping Windows fonts) is rejected per-item with the issue list, never written.
2. **Running profiles fail-closed**: rotation mid-session would desynchronize the live fingerprint; running ids land in the report as `{ ok: false, error: "running" }` and keep their old fingerprint.
3. **Per-item atomicity**: each profile updates in its own transaction; one profile's failure (locked DB row, validator rejection) never aborts the batch.
4. **Deterministic rotate**: `rotate` accepts optional `seed_hint`; without it, each profile draws a fresh family from the catalog weighted by market-share weights. Same `seed_hint` + same profile ⇒ same result (replayable operations).
5. **Report shape** mirrors `bulk-start`/`bulk-stop` (existing renderer bulk client parses it without new plumbing).

## Testing Strategy

- `tests/unit/bulkFingerprint.test.ts` in the sandboxed DB harness (pattern of `tests/unit/db.test.ts`):
  - rotate on 3 stopped profiles → all `ok`, seeds changed, coherence passes, old seeds differ.
  - one running profile in the batch → skipped with `running`, others still applied.
  - patch violating coherence (mac UA + win fonts) → per-item rejection with issue list, nothing persisted.
  - seed_hint determinism: identical request twice ⇒ identical seeds.
  - per-item atomicity: force a validator failure on item 2 of 3 → items 1 and 3 persist.