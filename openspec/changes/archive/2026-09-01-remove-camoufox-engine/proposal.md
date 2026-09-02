## Why

Camoufox is an incomplete managed path whose continued availability creates unsupported launch, sync, import, cleanup, and compatibility behavior. This first safety slice captures a pre-removal inventory and legacy API corpus, then disables the product path without converting or destroying preserved Firefox data.

## What Changes

- Inventory and snapshot every Camoufox/Firefox path before removal: configuration, SQLite rows, imports/bundles, API routes, launcher/start/stop/shutdown, syncer, UI, docs/status/geolocation/rate-limit claims, probes, package resources/dependencies, and on-disk data.
- After both child plans are separately approved, coordinate with `establish-parity-baseline`: baseline creates a fully isolated disposable clone of the pre-denial executable/build, DB, and profile filesystem; all mutating Firefox corpus fixtures run only there. Production denial/removal begins only after clone evidence emits verified `LEGACY_CORPUS_SIGNED`; Chromium characterization may continue afterward.
- Reject create, start, stop, import, duplicate, bulk, script, and sync operations for Firefox/Camoufox with stable documented errors; do not auto-convert.
- Preserve raw Firefox data indefinitely in a durable `preserved_browser_data` registry independent of profile/trash metadata unless an authorized operator performs explicit typed-confirmation cleanup.
- Make export/cleanup audited, traversal-safe, rollbackable, and permission checked.

## Capabilities

### New Capabilities
- `camoufox-removal`: Safe inventory, refusal, preservation, export, explicit cleanup, and rollback behavior for removal of the Camoufox product path.
- `adspower-api-compatibility`: Versioned compatibility corpus and stable refusal contracts for legacy and Chromium AdsPower V1/V2 operations.

### Modified Capabilities
- `action-syncer`: Replace the generic Firefox unsupported behavior with the stable removal-era compatibility error and race-safe session refusal.
- `profile-trash`: Exempt preserved raw Firefox data from automatic and ordinary permanent purge; require explicit authenticated cleanup.

## Impact

Affected systems include SQLite/profile repositories, profile schemas, imports and bundles, AdsPower V1/V2 routes, launcher/runtime lifecycle and shutdown, Action Syncer, Scripts/bulk operations, profile-trash purge, UI/docs, diagnostics/status/geolocation/rate-limit documentation, package resources/dependencies, audit logging, and raw user-data directories. Dependency: the baseline child MUST finish and sign the legacy Firefox request/response/error corpus before destructive code-path deletion begins.

## Migration and rollback

Migration is inventory -> immutable snapshot/corpus handoff -> feature disable -> stable refusal -> package/resource removal -> explicit export/cleanup availability. Rollback restores only product-path code/config from the pre-removal snapshot; it never overwrites preserved raw data. Cleanup uses quarantine/rename plus a recovery journal before final deletion.
