## Why

A verified defect: `StealthOptions.fontList` is declared at `src/main/proxy/stealthInjection.ts:36` and consumed nowhere in the repository. The injection contains zero font hooks, so a page that enumerates fonts still sees the host machine's inventory. ShardX pins font enumeration at the system level; a profile claiming a phone must report a phone's fonts, not the operator's Windows fonts.

The catalog already carries the data this needs — every family has `fontInventory` (`src/main/fingerprints/types.ts:100`), populated per platform in `win11Families.ts`, `macosFamilies.ts` and `linuxFamilies.ts`, and guarded by coherence checks in `validator.ts` (macOS families must not carry `Segoe UI`, Windows families must not carry Apple fonts). None of it reaches the browser.

## What Changes

- New `src/main/fingerprints/fonts.ts`: resolves a family's inventory into a runtime font config, including which host fonts must be hidden and which declared-but-absent families must still measure as present.
- `stealthInjection.ts`: consume `StealthOptions.fontList`; emit a `fonts` block into the generated `CFG` payload; add font hooks to the injected script.
- `stealthNoise.ts`: per-platform fallback inventory when a family has none (mirrors `migration.ts` defaults).
- Masking surfaces: `document.fonts.check` / `FontFaceSet.prototype.check`, `CanvasRenderingContext2D.prototype.measureText`, the element-metrics font probe (`font-family` applied to a sized element and `offsetWidth`/`offsetHeight` compared), and `navigator.fonts.queryLocalFonts`.

## Scope boundary

The kernel exposes `--disable-spoofing=font` (`docs/KERNEL.md`), which means the engine has its own font handling we cannot configure per profile. This slice does NOT attempt to replace engine behaviour; it masks the surfaces a page can actually measure from the injection layer, and is marked `TODO(engine-parity: fonts)` consistent with the existing marker convention.

## Capabilities

### New Capabilities
- `font-pinning`: profile-coherent font enumeration, measurement masking, and host-font hiding.

### Modified Capabilities

None.

## Impact

- `src/main/proxy/stealthInjection.ts`, `src/main/proxy/stealthNoise.ts`, new `src/main/fingerprints/fonts.ts`, `src/main/profiles/profileManager.ts` (populate `fontList` from the resolved family), `tests/unit/stealth/fontPinning.test.ts`.
