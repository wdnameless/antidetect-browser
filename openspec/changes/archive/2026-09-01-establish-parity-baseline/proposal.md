## Why

Current stealth, diagnostics, packaging, and API claims are not backed by strict machine-readable gates. This first-wave child captures the legacy Firefox corpus before removal and then establishes a Chromium-only, Windows-pinned evidence baseline without authorizing later parity implementation.

## What Changes

- After separate user approval of both child plans, clone the pre-denial executable/build, DB, and profile filesystem into a fully isolated disposable environment; run every mutating Firefox fixture only there and publish the signed barrier artifact before production denial/removal.
- Characterize Chromium after removal independently across browser contexts, network diagnostics, packaging/repo hygiene, API compatibility, and privacy leakage.
- Define a machine-readable Windows release policy with exact commands, pinned VM/toolchain/checker matrix/assertions/thresholds, signed dated evidence, retention, and fail-closed quarantine rules.
- Correct public/docs claims to evidence-qualified language and forbid undetectability claims.

## Capabilities

### New Capabilities
- `parity-baseline`: Reproducible Windows baseline, release-policy schema, evidence provenance, claim discipline, and repository/release hygiene.

### Modified Capabilities
- `network-diagnostics`: Make results tri-state, evidence-backed, permission checked, race safe, and non-successful when required probes are unresolved.

## Impact

Affected systems: AdsPower V1/V2 clone recorder/replay fixtures, browser launch/test harnesses, Windows CI/VM, diagnostics, claims, package/repository hygiene, and evidence retention. Universal order: both approvals; isolated clone; mutating Firefox fixtures only in clone with production behavior unchanged; sign/verify/publish barrier; production denial; path removal; independent Phase B Chromium characterization.

## Migration and rollback

Baseline artifacts are additive. Claim corrections ship without changing AdsPower behavior. Rollback removes only candidate policy/evidence metadata, never the signed legacy corpus or user data. A prior release policy remains active until a newer monotonic signed policy is accepted.
