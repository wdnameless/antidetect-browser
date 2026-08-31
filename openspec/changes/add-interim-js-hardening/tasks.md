## 1. Prototype and toString spoofing infrastructure

- [ ] 1.1 Implement native-like `toString` utility and property descriptor helper in `src/main/proxy/stealthInjection.ts`.
- [ ] 1.2 Add tests verifying `toString()`, `Symbol.hasInstance`, and prototype chain invariants for all hooked methods.

## 2. Seeded noise injection for rendering and audio APIs

- [ ] 2.1 Implement deterministic canvas 2D and WebGL readout noise hooked to profile sub-seeds.
- [ ] 2.2 Implement deterministic AudioBuffer and AnalyserNode phase noise.
- [ ] 2.3 Implement DOMRect and ClientRects sub-pixel jittering.

## 3. Peripheral API and voice alignment

- [ ] 3.1 Implement realistic `speechSynthesis.getVoices()` spoofing aligned with Windows locale.
- [ ] 3.2 Implement `navigator.getBattery()` and `mediaDevices.enumerateDevices()` coherence hooks.
- [ ] 3.3 Ensure all interim JS hooks include standardized `// TODO(engine-parity)` reference headers.

## 4. Testing and validation

- [ ] 4.1 Vitest suite for prototype integrity and deterministic noise consistency in `tests/unit/stealth/`.
- [ ] 4.2 Run `openspec validate add-interim-js-hardening --strict`.
