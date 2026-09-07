## Why

Modern anti-fraud and device fingerprinting systems (e.g., Cloudflare Turnstile, DataDome, Kasada, CreepJS, FingerprintJS Pro) detect antidetect browsers primarily by identifying cross-subsystem incoherencies in generated fingerprints. 

Common detection vectors include:
- GPU renderer claims that do not correspond to the claimed operating system or device model (e.g., Apple M-series GPU reported on Windows, or RTX 4090 reported on an Intel MacBook).
- WebGL extensions, shader precision formats, and WebGPU limits mismatched against the reported GPU architecture.
- Screen resolutions and device pixel ratios that contradict hardware form factors or OS windowing conventions.
- AudioContext oscillator frequencies and dynamics compressor fingerprints that conflict with the underlying OS audio stack.
- Font metrics and installed font lists that do not match the OS version (e.g., Segoe UI variable fonts on older macOS or missing SF Pro on Sequoia).

To achieve state-of-the-art stealth parity, the fingerprint generation subsystem must transition from random attribute selection to an authenticated, empirically collected catalog of coherent device profiles with strict cross-attribute validation.

## What Changes

- Expand the fingerprint catalog with empirical, multi-platform device profiles collected from real Windows, macOS, and Linux hardware.
- Implement a strict coherence validation engine that checks consistency across:
  - OS version <-> User-Agent / Client Hints.
  - OS <-> GPU vendor, renderer strings, WebGL parameters, and WebGPU limits.
  - Device form factor <-> Screen dimensions, color depth, and device pixel ratio (`window.devicePixelRatio`).
  - OS <-> Installed font sets and font rendering metrics.
  - OS <-> AudioContext parameters and oscillator sample hashes.
- Introduce automated coherence verification checks at profile creation and launch time, warning or blocking impossible configurations.
- Provide a catalog update mechanism allowing updated browser/hardware baselines to be loaded without application rebuilds.

## Capabilities

### New Capabilities
- `fingerprint-catalog`: Empirically validated, coherent multi-platform hardware and browser fingerprint catalog with cross-subsystem consistency verification.

### Modified Capabilities
- None

## Impact

- Runtime: Fingerprint generation and validation modules (`src/main/fingerprint/`, `src/shared/types/fingerprint.ts`).
- Assets: Expanded profile baseline datasets in `assets/fingerprints/`.
- UI: Profile configuration UI displays coherence status indicators and prevents impossible hardware combinations.

## Goals / Non-Goals

**Goals:**
- Eliminate cross-attribute fingerprint incoherencies across WebGL, WebGPU, Audio, Canvas, Fonts, and Navigator.
- Provide comprehensive empirical baselines for Windows 10/11, macOS (Intel & Apple Silicon M1-M4), and standard Linux distributions.
- Validate 100% coherence score on CreepJS and BrowserLeaks for all catalog profiles.

**Non-Goals:**
- Fabricating synthetic, nonexistent hardware combinations.
- Real-time modification of native host OS graphics drivers beyond browser-level interception.

## Risks / Trade-offs

- [Catalog Obsolescence] -> New browser versions or OS releases may make older catalog entries stand out. Mitigation: Dynamic catalog updates and monthly baseline refreshes.

## Migration and rollback

- Backward compatible with existing stored profiles; legacy profiles pass through coherence check with non-blocking warnings.
- Rollback: Revert catalog schema and fallback to standard generator without loss of profile data.
