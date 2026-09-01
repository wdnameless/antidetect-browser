## Context

This is not executable until separately user-approved. After both approvals, baseline clones the pre-denial executable/build, DB, and profile filesystem into a disposable isolated environment. All mutating Firefox fixtures execute only in that clone while production behavior remains unchanged. Production denial/removal begins only after verified publication of `LEGACY_CORPUS_SIGNED`.

## Goals / Non-Goals

**Goals:** complete path inventory; deterministic refusals; raw-data preservation; authenticated safe export/cleanup; coherent V1/V2 compatibility; reversible removal.

**Non-Goals:** profile conversion, Firefox runtime repair, Chromium parity implementation, general trash redesign, or relaxing current RBAC.

## Decisions

### Lifecycle and race barrier

After approval, states are `APPROVED -> CLONE_CREATED -> CLONE_CORPUS_RUNNING -> LEGACY_CORPUS_SIGNED -> PRODUCTION_DENIAL_ENABLED -> CODE_REMOVED`. No production denial or mutation occurs before the signed barrier. Mutating create/import/duplicate/start/stop/bulk/script/sync fixtures run only against the clone. Deletion/package cleanup requires verified envelope plus no active production Firefox process/session. Concurrent production requests observe one state revision; stale writes fail.

### Inventory manifest

The inventory is machine-readable and covers config keys/environment, DB tables/columns/rows, profile types, import/export bundles, all API operations, launcher/process/shutdown hooks, Action Syncer, scripts/bulk, UI/navigation/i18n, docs and `/status`/geolocation/rate-limit claims, diagnostics/probes, package resources/build includes/dependencies, logs/cache/temp, and every canonical/raw data directory. Each entry records owner, evidence command, disposition, preservation class, and rollback action.

### Stable compatibility behavior

The clone corpus freezes V1/V2 request bytes/content type/headers, HTTP status, response content type/headers, envelope shape, application code/body, side effects, and precedence for create/start/stop/import/duplicate/bulk/script/sync. Current implementation evidence shows JSON requests and per-item bulk success/failure reporting, while current Action Syncer planning specifies `UNSUPPORTED`; none of that is treated as the final compatibility contract until the corpus pins exact behavior. Mixed Chromium/Firefox bulk behavior (atomic vs per-item, ordering, side effects, envelope/application code) MUST be discovered and frozen. Removal MUST NOT invent HTTP status, header, envelope, or code, and MUST NOT proceed until corpus replay defines the post-removal refusal mapping. `/status`, geolocation, and rate-limit docs are reconciled to corpus evidence.

### Preservation, export, and cleanup

`preserved_browser_data` is a durable registry independent of profiles/trash with registry ID, owner/tenant, former profile ID, canonical allowlisted root, data class, inventory/digest, state revision, quarantine journal, created/preserved timestamps, and audit linkage. It survives metadata purge and supports authorized export, restore, and explicit cleanup. Preservation is indefinite until authorized cleanup. Export/restore/cleanup require RBAC, recent re-authentication, ownership, explicit registry ID, and audit. Cleanup requires typed confirmation bound to registry ID plus current digest. Canonical paths must remain under allowlisted roots and reject traversal, symlinks/junctions/reparse points. Quarantine/journal makes crash recovery and rollback exact; there is no time-based deletion or recovery window.

## Acceptance command contract

Implementation first creates wrappers. Vitest writes immutable raw evidence to `evidence/raw/<suite>.vitest.json` using `vitest run <paths> --reporter=json --outputFile=evidence/raw/<suite>.vitest.json`; record its SHA-256 and never overwrite it. A wrapper reads that raw file and separately writes RFC 8785 canonical `evidence/normalized/<suite>.summary.jcs.json` with `{schemaVersion,command,status,passed,failed,unresolved,rawPath,rawSha256,summarySha256,assertions,artifacts,startedAt,finishedAt}`. It never writes the raw path. Vitest nonzero, raw digest mismatch, `failed>0`, `unresolved>0`, or non-pass summary makes the wrapper nonzero. Artifact hygiene likewise emits separate raw command capture and canonical summary around `git diff --check`.

## Risks / Trade-offs

- [Corpus/removal race] -> signed barrier and state revision transaction.
- [Traversal or junction escape] -> canonical-root checks, reparse-point refusal, and adversarial tests.
- [Accidental purge] -> independent durable registry plus modified profile-trash contract.
- [Compatibility drift] -> frozen corpus replay on V1 and V2.

## Rollback

Disable removal gates, restore code/config/package entries from the snapshot, replay schema rollback if safe, and restore quarantined raw data from the journal. Never reconstruct or convert user data. If rollback validation fails, keep Firefox disabled and data preserved.
