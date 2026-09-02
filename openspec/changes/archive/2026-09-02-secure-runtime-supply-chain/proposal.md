## Why

Umbrella `stealth-parity-hardening` task 3.1 requires this child before any private engine child ships. Afina publicly differentiates on Ed25519-signed extensions/scripts/modules (one altered byte = no run). Our runtime delivery and script/module execution currently have no signature verification: a tampered engine binary, extension or script artifact would run silently.

## What Changes

- Ed25519-signed JCS manifests for runtime releases (launcher, engine, shipped PE/DLL) with monotonic version anti-rollback.
- Key-ring management: rotation, revocation, recovery; offline verification path.
- Ed25519 signatures over md5 manifests for script-engine modules and stealth extension artifacts; executor refuses unsigned/tampered payloads (fail closed, dev-mode override behind explicit flag).
- SBOM generation + verification in CI; Authenticode verification of shipped PE/DLL files on Windows.
- Rollback-state integrity and crash/locked-file recovery for runtime updates.

## Capabilities

### New Capabilities
- `runtime-supply-chain`: signed runtime delivery, artifact signature enforcement, SBOM and key-ring contracts.

### Modified Capabilities

None.

## Impact

- New `src/main/security/signing.ts`, release tooling, script-engine loader hook, CI jobs; satisfies umbrella gate 3.1 for later engine children.
- Risk: key compromise playbook must exist before signing is mandatory; dev workflow needs a documented unsigned-local-build escape hatch.
