## 1. Signing core

- [ ] 1.1 Implement `src/main/security/signing.ts`: Ed25519 keypair handling, JCS canonicalization, sign/verify over md5 file manifests.
- [ ] 1.2 Key-ring store: rotation, revocation list, recovery procedure; offline verification without network.
- [ ] 1.3 Unit tests: sign/verify round-trip, tamper detection per byte-flip, revoked key rejection, anti-rollback monotonic version check.

## 2. Enforcement points

- [ ] 2.1 Script-engine loader verifies module signature before execution; refuse unsigned/tampered with audit log entry.
- [ ] 2.2 Stealth-extension artifact verification at profile launch; fail closed with remediation error.
- [ ] 2.3 Runtime release manifest verification on update/download incl. rollback-state integrity and locked-file recovery.
- [ ] 2.4 Explicit `--allow-unsigned-dev` escape hatch, never default, logged loudly; tests prove production builds ignore it.

## 3. CI and evidence

- [ ] 3.1 SBOM generation + verification job; Authenticode check for all shipped PE/DLL on Windows.
- [ ] 3.2 Key compromise runbook documented; dated verification evidence under evidence/.
