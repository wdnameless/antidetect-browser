## Context

Anti-bot systems employ machine-learning anomaly detectors that flag browsers presenting conflicting or statistically improbable hardware and software attributes. While early antidetect tools randomized individual attributes independently, current detection logic cross-references dozens of correlated parameters.

To reach enterprise stealth parity, we must replace naive randomized permutations with an empirically collected catalog of coherent device archetypes, reinforced by a deterministic coherence validator.

## Decisions

### 1. Catalog Architecture and Empirical Schema
- Hardware profiles are defined as immutable Archetype Definitions stored in JSON/MessagePack format (`assets/fingerprints/catalog-v2.json`).
- Each catalog entry encapsulates:
  - `hardware`: Platform, CPU architecture, core count, memory range, GPU vendor, GPU model, WebGL unmasked renderer/vendor, WebGL supported extensions, WebGL parameter limits, WebGPU limits.
  - `display`: Screen resolution, available dimensions, color depth, devicePixelRatio.
  - `audio`: Sample rate, channel count, oscillator frequency response signatures, dynamics compressor reduction values.
  - `fonts`: OS-native font whitelist and baseline text metric offsets.
  - `software`: OS family, OS version, kernel release, User-Agent, Sec-CH-UA brand lists, Sec-CH-UA-Platform-Version.

### 2. Coherence Validation Engine (`FingerprintCoherenceValidator`)
- Enforces multi-dimensional consistency rules:
  1. **OS-GPU Rule:** Rejects Apple Silicon renderers on Windows/Linux; rejects DirectX/ANGLE Direct3D renderers on macOS; rejects NVIDIA RTX on macOS 14+.
  2. **Display-DPR Rule:** Requires DPR >= 2.0 for Retina MacBooks and high-DPI Windows laptops; restricts standard 1920x1080 desktop screens to DPR = 1.0 or 1.25.
  3. **Audio-OS Rule:** Verifies that audio buffer latency and sample rate align with OS-specific audio sub-architectures (CoreAudio vs WASAPI vs PulseAudio).
  4. **Font-OS Rule:** Disallows Windows-only typography (e.g., Calibri, Segoe UI) on macOS profiles without compatibility layers, and ensures Apple system fonts exist on macOS.
  5. **Client Hints-UA Rule:** Ensures high-entropy client hints (`Sec-CH-UA-Full-Version-List`, `Sec-CH-UA-Platform-Version`) precisely correlate with the nominal User-Agent string.

### 3. Profile Generation Pipeline
- When a user creates or randomizes a profile, the generator selects an empirical archetype matching the desired OS target.
- Noise injection (e.g., canvas 2D noise, WebGL readPixels subtle perturbation) is applied within mathematically bounded noise envelopes that preserve archetype classification while avoiding deterministic canvas tracking across profiles.
- Pre-launch validator checks profile coherence; impossible permutations trigger validation errors or auto-correction prompts.

## Risks / Trade-offs

- [Catalog Size and Distribution] -> High-resolution catalogs could increase installer binary size.
  - *Mitigation:* Compact binary encoding (MessagePack / Brotli compression) keeps the full multi-platform catalog under 5 MB.

## Migration Plan

- Deploy `catalog-v2.json` alongside existing legacy baselines.
- Update profile creation dialog to query catalog archetypes.
- Existing profiles retain their settings but show a coherence rating indicator in profile diagnostics.
