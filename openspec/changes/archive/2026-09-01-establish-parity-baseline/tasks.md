## 1. Authorization and isolated clone

- [x] 1.1 Obtain explicit user approval of this complete child draft before any script, clone, code, test, corpus, or migration work; umbrella approval is insufficient.
- [x] 1.2 After both approvals, create a disposable isolated clone of pre-denial executable/build, DB, and profile filesystem; prove mutating fixtures can reach only clone paths while production behavior remains unchanged.

## 2. Create wrappers before use

- [x] 2.1 Create missing legacy-corpus, corpus-sign/verify, policy, Chromium, WebRTC, network-capture, hygiene, privacy, claims, and JSON artifact-hygiene wrapper scripts plus npm entries; test schema `{schemaVersion,command,status,passed,failed,unresolved,assertions,artifacts,startedAt,finishedAt}` and nonzero fail/unresolved exits.
- [x] 2.2 Create Vitest suites/wrappers using immutable `evidence/raw/<suite>.vitest.json` and separate canonical `evidence/normalized/<suite>.summary.jcs.json`; test raw non-overwrite, both digests/schema, and nonzero rules.

## 3. Clone-only legacy corpus barrier

- [x] 3.1 Run create/import/duplicate/start/stop/bulk/script/sync fixtures only inside the disposable clone; capture exact V1/V2 request/response headers/content types/status/envelope/application codes, precedence, side effects, and mixed-bulk semantics to JSON.
- [x] 3.2 Canonicalize corpus with RFC 8785 JCS, digest SHA-256, create the domain-separated Ed25519 envelope fields from design.md, publish content-addressed immutable artifacts, and run the created verifier/replay wrapper.
- [x] 3.3 Emit `LEGACY_CORPUS_SIGNED` only on trusted key/schema/digest/signature/provenance/replay pass; then unblock removal production denial without waiting for Phase B.

## 4. Chromium and release baseline

- [x] 4.1 Run Chromium engine launch matrix inside isolated clone; verify runtime baseline flags, sandbox/isolation options, clean shutdown/signal handling, process cleanup, and schema match.
- [x] 4.2 Run network, WebRTC leak, canvas/WebGL/audio, client hints, and proxy baseline fixtures; compare with legacy corpus baseline and record schema-validated results to `evidence/raw/baseline-parity.vitest.json` and canonical summary.
- [x] 4.3 Simulate unavailable, stale, quarantined, unsigned, tampered, threshold-failing, and conflicting evidence; require JSON non-pass and nonzero exits.

## 5. Completion acceptance

- [x] 5.1 Package and publish canonical baseline artifacts (`evidence/baseline-parity.json`, `evidence/raw/` and `evidence/normalized/` summaries); verify all schemas, digests, and signatures.
- [x] 5.2 Obtain final independent Oracle/acceptance approval before completion/archive; this child archives/syncs its deltas independently.
