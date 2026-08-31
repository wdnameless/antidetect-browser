## 1. Authorization and workflow barrier

- [x] 1.1 Obtain explicit user approval of this complete child draft before any inventory script, code, test, denial, migration, or data operation; umbrella approval is insufficient.
- [ ] 1.2 After BOTH child approvals, require baseline to create the isolated pre-denial clone, run mutating Firefox fixtures only there while production remains unchanged, and canonicalize/sign/verify/publish `LEGACY_CORPUS_SIGNED` before any production denial.

## 2. Create acceptance wrappers

- [x] 2.1 Create the missing audit, corpus-verifier, contract-replay, docs, package, E2E, and artifact-hygiene wrapper scripts plus their npm entries before invoking them; unit-test the required JSON schema and nonzero fail/unresolved behavior.
- [x] 2.2 Create Vitest suites and wrappers that write immutable `evidence/raw/<suite>.vitest.json`, digest it, then write separate canonical `evidence/normalized/<suite>.summary.jcs.json`; test no overwrite, raw/summary digest fields, and all nonzero exit rules.

## 3. Inventory and durable preservation

- [ ] 3.1 Run the created inventory wrapper to `evidence/camoufox-inventory.json`; require zero unclassified configuration, DB, bundle, route, lifecycle, syncer, UI/docs/probe/package/dependency/data paths.
- [ ] 3.2 Create `preserved_browser_data` registry and transactional population; verify metadata purge survival, owner/tenant checks, canonical roots, digest/inventory, revisions, timestamps, journal, and audit linkage with Vitest JSON evidence.
- [ ] 3.3 Implement authenticated export/restore and typed-confirmation cleanup bound to registry ID+digest; verify traversal/junction, cross-tenant, stale digest/revision, replay, crash, locked-file, and indefinite preservation cases.

## 4. Production denial and removal

- [ ] 4.1 Only after 1.2, atomically enable production create/import/duplicate/start/stop/bulk/script/sync refusal according to corpus-pinned status/header/content-type/envelope/application-code and mixed-bulk semantics; replay V1/V2 corpus to JSON.
- [ ] 4.2 Remove launcher/UI/routes/probes/resources/dependencies after denial and verify package/docs wrappers plus valid Vitest JSON summaries.
- [ ] 4.3 Rehearse rollback from denial, code removal, and quarantine states; verify preserved registry/data digests and API corpus replay remain valid.

## 5. Completion acceptance

- [ ] 5.1 Run all created wrappers, strict OpenSpec validation, and JSON artifact-hygiene wrapper; require `status:"pass"`, `failed:0`, `unresolved:0` in each output.
- [ ] 5.2 Obtain final independent Oracle/acceptance approval before completion or archive; implementation child archives/syncs its own deltas independently.
