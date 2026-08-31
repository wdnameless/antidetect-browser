## Purpose

Defines the interim user-script stealth hardening layer for Chromium MV3 injection, including seeded deterministic noise across rendering and audio surfaces, prototype toString integrity, peripheral API alignment, and engine-patch cross-references.

## ADDED Requirements

### Requirement: Native-like toString and prototype integrity
Overridden JavaScript prototype methods MUST present standard native string representations and accurate property descriptors.

#### Scenario: Method toString verification
- **GIVEN** a stealth-injected browser session
- **WHEN** inspecting `Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL)`
- **THEN** it MUST return `"function toDataURL() { [native code] }"` and have standard non-enumerable descriptor attributes

### Requirement: Seeded deterministic rendering and audio noise
Canvas, WebGL, DOMRect, and AudioBuffer readout operations MUST apply reproducible, sub-perceptual noise derived from profile sub-seeds.

#### Scenario: Canvas hash alteration with fixed seed
- **GIVEN** a profile with fixed canvas sub-seed
- **WHEN** rendering and extracting a canvas test pattern twice in the same profile
- **THEN** both extractions MUST yield identical hash outputs, but differ deterministically from a baseline or differently-seeded profile

### Requirement: Peripheral API and speech voice coherence
Peripheral APIs (SpeechSynthesis, Battery, MediaDevices) MUST expose realistic device structures coherent with the profile operating system and hardware profile.

#### Scenario: SpeechSynthesis voice list retrieval
- **GIVEN** a Windows 11 en-US profile
- **WHEN** calling `window.speechSynthesis.getVoices()`
- **THEN** it MUST return a populated array of Windows-compatible speech voices rather than an empty list

### Requirement: Interim status and engine-patch cross-referencing
Every userland prototype patch MUST be marked with an explicit TODO cross-reference to its future engine patch.

#### Scenario: Source annotation check
- **GIVEN** the stealth script bundle in `src/main/proxy/stealthInjection.ts`
- **WHEN** scanning userland API overrides
- **THEN** each override MUST contain a `// TODO(engine-parity)` reference comment
