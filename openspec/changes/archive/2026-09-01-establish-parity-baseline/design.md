## Context

Manual checkers are not CI gates, WebRTC currently exits zero, and docs drift. This is not executable until separately user-approved. After both first-wave approvals it synchronizes with removal through the signed clone-only legacy-corpus barrier.

## Goals / Non-Goals

**Goals:** freeze observable legacy behavior; pin reproducible Windows evidence; turn required checks into nonzero machine gates; correct claims; include repo/package hygiene and privacy leakage.

**Non-Goals:** implementing engine patches, network enforcement, SDK/MCP/runtime-trust changes, or claiming detection immunity.

## Decisions

### Two-phase baseline

Phase A creates a fully isolated disposable clone of the pre-denial executable/build, DB, and profile filesystem. Mutating create/start/stop/import/duplicate/bulk/script/sync fixtures run ONLY in that clone, never production state. It captures request bytes/content type/headers, HTTP status, response content type/headers, envelope/application code/body, ordering/side effects, mixed Chromium/Firefox bulk semantics, `/status`, geolocation, and rate-limit precedence. It then emits verified `LEGACY_CORPUS_SIGNED`; only afterward may removal deny production writes. Phase B may continue Chromium characterization after removal without making removal wait for full baseline completion.

### LEGACY_CORPUS_SIGNED envelope

Corpus content is RFC 8785 JCS UTF-8 canonical bytes with SHA-256. Ed25519 signs domain-separated bytes `antidetect:legacy-corpus:v1\0` followed by the RFC 8785 canonical envelope-without-signature. Envelope fields are `schemaVersion`, `corpusSha256`, `contentAddress`, `createdAt`, `sourceBuildSha256`, `cloneExecutableSha256`, `cloneDbSha256`, `cloneFilesystemInventorySha256`, `apiVersions`, `fixtureSetSha256`, `keyId`, `signatureAlgorithm`, and `signature`. Trusted key ID resolves through the repository-pinned release public-key ring. Publication is immutable and content-addressed by corpus digest. Verification checks JCS/schema, content digest/address, signature/domain, trusted non-revoked key ID, source/clone provenance, and replay of fixture IDs; any mismatch or conflicting/replayed envelope fails closed.

### Machine-readable release policy

`release-policy.json` pins Windows image digest/build, locale/timezone, CPU/GPU class, network/firewall profile, Node/npm/Electron/Chromium/fingerprint-chromium versions, checker URLs/versions/digests, packet capture tooling, commands, assertions, thresholds, retries/timeouts, required/optional classification, and evidence retention. Required assertions are Boolean unless a numeric threshold and sampling rule are explicit. Any unresolved, quarantined, unavailable, stale, unsigned, or threshold-failing required check blocks stable.

### Evidence schema and commands

Vitest writes immutable raw evidence to `evidence/raw/<suite>.vitest.json` via `vitest run <paths> --reporter=json --outputFile=evidence/raw/<suite>.vitest.json`; its SHA-256 is recorded and the file is never overwritten. A wrapper reads raw evidence and separately emits RFC 8785 canonical `evidence/normalized/<suite>.summary.jcs.json` with `{schemaVersion,command,status,passed,failed,unresolved,rawPath,rawSha256,summarySha256,assertions,artifacts,startedAt,finishedAt}` plus policy/candidate/tool/VM digests, signer, and redaction report. The wrapper never writes the raw path. Vitest nonzero, digest mismatch, failed/unresolved count, or non-pass status exits nonzero. Artifact hygiene uses separate raw capture and normalized summary around `git diff --check`. Evidence retention is at least two stable lifetimes and 24 months.

- `npm run baseline:legacy-api -- --versions v1,v2 --out evidence/legacy-firefox-corpus.json`
- `npm run baseline:chromium -- --policy release-policy.json --out evidence/chromium.json`
- `npm run check:webrtc -- --strict --json evidence/webrtc.json`
- `npm run check:network-capture -- --policy release-policy.json --json evidence/pcap.json`
- `npm run check:repo-release-hygiene -- --json evidence/hygiene.json`
- `npm run check:privacy-artifacts -- --json evidence/privacy.json`
- `npm run claims:verify -- --json evidence/claims.json`

The task order creates every listed missing script before use. Assertions require zero direct ICE candidates for proxied fixtures, zero direct packets in capture/firewall logs, unknown not pass, zero forbidden secrets/private artifacts/package residues, zero unsupported undetectability claims, and exact corpus replay of discovered headers/content types/status/envelope/application codes/side effects/mixed-bulk behavior.

### Privacy and claim discipline

Evidence, logs, dumps, checker artifacts, screenshots, MCP-like arguments/results, and telemetry fixtures exclude URLs, page content, cookies, storage, proxy credentials, secrets, raw fingerprints, and stable cross-session identifiers. Withdrawal stops future collection immediately; retention/export/delete operate by pseudonymous evidence subject while preserving legally required aggregate release attestations. Public claims state tested version, date, matrix, and limitations and never promise undetectability.

## Risks / Trade-offs

- [Checker changes] -> digest/version pinning; required drift is unresolved and blocks stable.
- [PII in artifacts] -> deny-by-default redaction scanner before signing.
- [Removal race] -> immutable DB/filesystem snapshot and signed barrier.
- [False confidence] -> evidence-qualified claims and explicit unknown state.

## Rollback

Keep the last accepted monotonic policy and evidence index. Reject a candidate policy that lowers sequence or weakens required checks without separately approved policy migration. Baseline rollback never re-enables Camoufox or edits user data.
