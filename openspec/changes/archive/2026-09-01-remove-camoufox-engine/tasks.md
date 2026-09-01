## 1. Authorization and workflow barrier

- [x] 1.1 Obtain explicit user approval of this complete child draft before any inventory script, code, test, denial, migration, or data operation; umbrella approval is insufficient.
- [x] 1.2 After BOTH child approvals, require baseline to create the isolated pre-denial clone, run mutating Firefox fixtures only there while production remains unchanged, and canonicalize/sign/verify/publish `LEGACY_CORPUS_SIGNED` before any production denial.

## 2. Create acceptance wrappers

- [x] 2.1 Create the missing audit, corpus-verifier, contract-replay, docs, package, E2E, and artifact-hygiene wrapper scripts plus their npm entries before invoking them; unit-test the required JSON schema and nonzero fail/unresolved behavior.
- [x] 2.2 Create Vitest suites and wrappers that write immutable `evidence/raw/<suite>.vitest.json`, digest it, then write separate canonical `evidence/normalized/<suite>.summary.jcs.json`; test no overwrite, raw/summary digest fields, and all nonzero exit rules.

## 3. Inventory and durable preservation

- [x] 3.1 Run the created inventory wrapper to `evidence/camoufox-inventory.json`; require zero unclassified configuration, DB, bundle, route, lifecycle, syncer, UI/docs/probe/package/dependency/data paths.
- [x] 3.2 Create `preserved_browser_data` registry and transactional population; verify metadata purge survival, owner/tenant checks, canonical roots, digest/inventory, revisions, timestamps, journal, and audit linkage with Vitest JSON evidence.
- [x] 3.3 Implement authenticated export/restore and typed-confirmation cleanup bound to registry ID+digest; verify traversal/junction, cross-tenant, stale digest/revision, replay, crash, locked-file, and indefinite preservation cases.

## 4. Production denial and removal

- [x] 4.1 Implement pre-launch, RPC, API, bundle-download, updater, and DB denial returning typed `422/unsupported_engine` payload; test direct execution rejection, config rejection, bundle-download block, and active profile rejection with Vitest JSON evidence.
- [x] 4.2 Remove launcher/UI/routes/probes/resources/dependencies after denial and verify package/docs wrappers plus valid Vitest JSON summaries.
- [x] 4.3 Rehearse rollback from denial, code removal, and quarantine states; verify preserved registry/data digests and API corpus replay remain valid.

## 5. Completion acceptance

- [x] 5.1 Verify acceptance criteria across pre-denial clone run, `LEGACY_CORPUS_SIGNED`, data preservation registry/export/cleanup, runtime denial, removal hygiene, and evidence digests.
- [x] 5.2 Obtain final independent Oracle/acceptance approval before completion or archive; implementation child archives/syncs its own deltas independently.
