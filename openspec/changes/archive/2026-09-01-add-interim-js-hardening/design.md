## Context

Stealth injection scripts injected via MV3 or CDP `Page.addScriptToEvaluateOnNewDocument` manipulate browser JavaScript APIs in userland. Sophisticated anti-bot detection libraries (e.g. CreepJS, FingerprintJS, DataDome) detect prototype patches via `toString()` inspection, prototype chain verification, and context leakage (such as unpatched Workers or `iframe.contentWindow`).

While the permanent architectural solution is engine-level patching (`patch-engine-*`), this interim child delivers a hardened userland layer to raise the bar against standard detection suites.

## Decisions

### 1. Native-like Function.prototype.toString Emulation
All patched functions are wrapped using a proxy/registry pattern where `Function.prototype.toString.call(wrappedFn)` returns `function ${name}() { [native code] }` with matching property descriptors (`writable: false, enumerable: false, configurable: true`).

### 2. Deterministic LSB Noise Algorithms
- Canvas: Subtle RGB LSB dithering seeded by `seed_canvas` applied during `getImageData`, `toDataURL`, and `toBlob`.
- Audio: Sub-audible frequency bin phase noise applied to `AnalyserNode.getFloatFrequencyData` and `AudioBuffer.copyFromChannel`.
- DOMRect / ClientRects: Sub-pixel fraction dithering (`+/- 0.0001px`) seeded by `seed_rects` to prevent font/rendering fingerprinting without breaking layout calculations.

### 3. Peripheral & Voice Coherence
- `speechSynthesis.getVoices()` returns a realistic list of 3-6 Microsoft system voices matching the profile's OS and locale (e.g., "Microsoft David", "Microsoft Zira", "Microsoft Mark" on Windows en-US).
- `navigator.mediaDevices.enumerateDevices()` returns virtual audio/video inputs with consistent device IDs.
- `navigator.getBattery()` returns charging/discharging states coherent with desktop (charging=true, level=1.0) vs laptop profiles.

### 4. Explicit Interim Disclaimer & Engine Mapping
Every patch in `stealthInjection.ts` contains a standardized header:
`// TODO(engine-parity): Interim userland hook. Superseded by patch-engine-blink.`

## Risks / Trade-offs

- [Worker / Iframe context leaks] -> Documented as an acceptable interim trade-off until engine patches land.
- [Performance overhead on heavy canvas operations] -> Noise generator uses fast XORSHIFT32 / LCG math to maintain sub-millisecond execution.

## Migration Plan

- Deploy updated `src/main/proxy/stealthInjection.ts`.
- Verify with unit tests and synthetic CreepJS fingerprint test runner.
