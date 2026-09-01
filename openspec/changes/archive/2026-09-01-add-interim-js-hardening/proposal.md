## Why

Until native Chromium engine-level patches (`patch-engine-*`) land, the application relies on an interim MV3 user-script injection layer (`src/main/proxy/stealthInjection.ts`) to mitigate obvious fingerprinting vectors. Currently, this layer contains detectable `Function.prototype.toString` leaks, unseeded/inconsistent noise generators, and unhandled fingerprinting APIs (ClientRects, AudioBuffer, SpeechSynthesis voices, Battery, and MediaDevices).

## What Changes

- Enhance `src/main/proxy/stealthInjection.ts` with seeded, deterministic noise algorithms for HTML5 Canvas 2D, WebGL readout, AudioBuffer data, and DOMRect / ClientRects.
- Implement native-like `Function.prototype.toString` and `Symbol.hasInstance` spoofing for all overridden JavaScript APIs to prevent naive prototype tampering detection.
- Provide coherent default voice pools for `speechSynthesis.getVoices()` matching the profile's OS and locale.
- Harmonize `navigator.getBattery()`, `navigator.mediaDevices.enumerateDevices()`, and Network Information API with profile hardware settings.
- Explicitly annotate every interim patch with a `// TODO(engine-parity): <ticket>` reference indicating that this JS-level mitigation is an interim layer and NOT a replacement for engine patches (iframe/worker context leaks remain until engine-level patching).

## Capabilities

### New Capabilities
- `interim-stealth-hardening`: Seeded deterministic JavaScript prototype and API hardening layer for MV3 extension injection.

### Modified Capabilities
- None

## Impact

- Affected files: `src/main/proxy/stealthInjection.ts`, `src/main/launcher/chromium.ts`.
- Dependencies: Governed under umbrella `openspec/changes/stealth-parity-hardening` (Tasks 5.1 & 5.2). Catalog dependency in Task 4.1.

## Goals / Non-Goals

**Goals:**
- Provide reproducible per-profile noise for Canvas, AudioBuffer, and ClientRects based on catalog seed.
- Eliminate naive `toString()` inspection detection of overridden methods.
- Align speech synthesis voices, media devices, and battery APIs with profile configuration.
- Clearly document interim status and known architectural limitations (such as nested worker / detached iframe bypasses).

**Non-Goals:**
- Serving as a release-gate or permanent replacement for C++ Chromium engine patches.
- Completely sealing web worker or isolated context leaks achievable only at the Blink/V8 engine level.

## Risks / Trade-offs

- [Interim layer limitations] -> Advanced fraud scripts probing inside Web Workers or cross-origin iframes may bypass JS prototypes; full mitigation occurs in subsequent `patch-engine-*` phases.
- [Canvas image distortion] -> Noise magnitude is constrained to sub-perceptual LSB dithering to prevent visual corruption while altering hash signatures.

## Migration and rollback

- Enabled conditionally via profile launch flag `interimJsStealth: true` (default true).
- Rollback: Setting flag to false restores previous baseline script injection.
