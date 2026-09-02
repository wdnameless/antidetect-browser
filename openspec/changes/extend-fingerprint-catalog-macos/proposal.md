## Why

The merged `fingerprint-catalog` delivers exactly 30 curated Windows families. Afina differentiates with per-OS/per-chip selection (macOS M1/M2/M3/M4, Intel Mac, Windows 10/11) whose WebGL renderer, audio signature, fonts and screen scale are mutually consistent; checkers cross-validate exactly these correlations. Windows-only identity also caps addressable profiles on Mac-heavy audiences.

## What Changes

- Add curated macOS families (M1/M2/M3/M4, Intel) and a Windows 11 refresh, built from documented public specifications only — no harvested/telemetry device data (respects umbrella non-goal).
- Extend the catalog schema with per-chip GPU renderer, audio context signature, font inventory, screen/color profile and Retina scale factors.
- Add a cross-property coherence validator executed in CI over every family (UA ↔ platform ↔ UA-CH ↔ WebGL ↔ screen ↔ fonts).
- Add a dated external-checker evidence gate (CreepJS/Pixelscan fixture runs) per `parity-baseline` conventions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `fingerprint-catalog`: adds macOS families, Win11 refresh, per-chip fields, and coherence/evidence gates.

## Impact

- Catalog data + schema migration (crc32/HMAC sub-seed derivation unchanged), `stealthNoise.ts` voice/GPU pools, validator + CI job, evidence artifacts.
- Risk: macOS-on-Windows-host tells (e.g. missing macOS-only APIs) must be enumerated and masked or excluded per family.
