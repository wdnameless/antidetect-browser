## Why

Profile spoofing currently relies on isolated, hardcoded defaults (such as `defaultPlatformVersion()` in `src/main/profiles/profileManager.ts` and `CHROME_VERSION`/`BRANDS` in `src/main/proxy/stealthInjection.ts`). Independent random selection across dimensions creates impossible hardware/software frankenstein profiles (e.g. RTX 4090 paired with 2-core CPU and 4GB RAM, or mismatched font metrics and screen color depths) that are trivially flagged by modern fraud-detection engines.

## What Changes

- Introduce an authoritative curated catalog of exactly 30 synthetic Windows hardware/software families based on dated public OEM and market-distribution sources (StatCounter, Steam Hardware Survey, Windows Device Portal 2026-08).
- Implement strictly normalized population weights (sum = 1.0) for deterministic weighted sampling.
- Introduce positive signed int32 seed space (`1..2147483647`) with domain-separated sub-seed derivation (HMAC-SHA256).
- Enforce cross-surface coherence across GPU (renderer/vendor/extensions), CPU (cores/concurrency), RAM (`deviceMemory`), Screen (resolution/colorDepth/pixelRatio), System Fonts, Locale/Timezone, and User-Agent / Client Hints.
- Define deterministic replay and migration behavior for legacy seed values (`0` or negative integers) so that profiles migrate deterministically without silent random drift.
- Replace hardcoded defaults in `profileManager.ts` and `stealthInjection.ts` with catalog-backed resolution.

## Capabilities

### New Capabilities
- `fingerprint-catalog`: Curated 30-family Windows coherent hardware/software catalog with domain-separated seed derivation, strict cross-surface invariants, and deterministic legacy migration.

### Modified Capabilities
- None

## Impact

- Affected files: `src/main/fingerprints/catalog.ts`, `src/main/fingerprints/derivation.ts`, `src/main/profiles/profileManager.ts`, `src/main/proxy/stealthInjection.ts`, `src/main/launcher/chromium.ts`.
- Dependencies: Governed under umbrella `openspec/changes/stealth-parity-hardening` (Task 4.1). Baseline established in Task 1.3.

## Goals / Non-Goals

**Goals:**
- Provide exactly 30 curated Windows profile families with verified realistic hardware combinations.
- Enforce strict cross-surface coherence rules preventing mismatched hardware attributes.
- Ensure 100% deterministic fingerprint generation from seed (`1..2147483647`).
- Guarantee deterministic upgrade path for legacy/invalid seeds without silent random regenerations.

**Non-Goals:**
- Generating infinite random combinations without catalog grounding.
- Supporting macOS / Linux synthetic profiles in this Windows-focused catalog change.

## Risks / Trade-offs

- [Catalog staleness over time] -> Catalog definitions are tagged with publication date and source citations; updated via structured catalog releases.
- [Legacy profile drift] -> Explicit deterministic seed mapping maps `0` or negative numbers to fixed positive seed offsets derived from profile ID hash.

## Migration and rollback

- Existing profiles with `seed <= 0` or missing seeds are migrated deterministically via `hash(profile_id) % 2147483646 + 1`.
- Rollback: Revert to previous default fallback functions in `profileManager.ts`.
