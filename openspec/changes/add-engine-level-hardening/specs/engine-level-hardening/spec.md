## Purpose

Defines native C++/Blink engine-level hardening specifications for Chromium builds, eliminating user-space JavaScript shims and ensuring native browser introspection parity across all fingerprinting surfaces.

## ADDED Requirements

### Requirement: Native elimination of automation indicators
The browser engine MUST strip `navigator.webdriver` directly in Blink IDL and C++ binding generator pipelines without requiring JavaScript wrappers or prototype modification.

#### Scenario: Script inspects navigator.webdriver descriptor
- **GIVEN** a web page running automated or manual inspection scripts
- **WHEN** the page checks `Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')`
- **THEN** the descriptor MUST evaluate to `undefined`
- **AND** `Object.prototype.hasOwnProperty.call(navigator, 'webdriver')` MUST return `false`

### Requirement: C++ font enumeration filtering
The engine MUST filter system font enumeration calls directly inside `FontCache` C++ implementations, preventing detection of unauthorized local OS fonts via Canvas, CSS font probes, or FontFaceSet API.

#### Scenario: Whitelisted font query succeeds natively
- **GIVEN** a profile configured with Windows 11 default font list
- **WHEN** a web page renders text using Arial or Segoe UI
- **THEN** Blink's `FontCache` MUST return native platform font data

#### Scenario: Non-whitelisted font probe returns fallback
- **GIVEN** a profile configured with Windows 11 default font list
- **WHEN** a web page queries an unlisted macOS-specific font such as "SF Pro Display"
- **THEN** Blink's `FontCache` MUST return `nullptr` as if the font does not exist on the operating system
- **AND** MUST NOT emit any console warnings or hook signatures

### Requirement: Deterministic native canvas noise injection
The engine MUST inject profile-seeded deterministic noise directly inside Blink's `ImageBuffer::ToDataURL` and pixel extraction pipelines before returning image buffers to JavaScript.

#### Scenario: Canvas readout contains subtle deterministic noise
- **GIVEN** a profile launched with a specific stealth seed
- **WHEN** a script draws text or geometries to a 2D canvas and calls `toDataURL('image/png')`
- **THEN** the resulting pixel data MUST contain subtle entropy matching the profile seed
- **AND** repeated calls on the exact same canvas within the same session MUST return identical base64 hashes

### Requirement: Native hardware concurrency and memory reporting
`navigator.hardwareConcurrency` and `navigator.deviceMemory` MUST be served directly by Blink C++ implementations reading from the profile configuration without JavaScript interception.

#### Scenario: Prototype integrity of hardware properties
- **GIVEN** a configured profile with 8 CPU cores and 8GB RAM
- **WHEN** a page invokes `Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get.toString()`
- **THEN** the returned function string MUST equal `'function get hardwareConcurrency() { [native code] }'`
- **AND** the getter MUST return `8`

### Requirement: WebGPU adapter substitution (parity program 2026-09-07)
Until the engine patch lands, the JS-interim layer MUST hide the host GPU from `navigator.gpu.requestAdapter` by resolving the profile family's adapter; the engine patch MUST substitute the adapter in the Dawn device path gated by `--stealth-engine-profile` so no JS surface exists.

#### Scenario: Host GPU never surfaces
- **GIVEN** a profile claiming an RTX 4060 family running on any host
- **WHEN** a page calls `navigator.gpu.requestAdapter()` then `adapter.requestAdapterInfo()`
- **THEN** the returned vendor/architecture/device MUST match the profile family and MUST NOT contain any host GPU identifier

#### Scenario: WebGPU-less families resolve like real devices
- **GIVEN** a Linux desktop family whose real Chrome exposes no WebGPU
- **WHEN** a page calls `navigator.gpu.requestAdapter()`
- **THEN** the call MUST resolve `undefined` exactly like real Linux Chrome

### Requirement: WebAuthn platform-authenticator coherence (parity program 2026-09-07)
`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable` MUST answer according to the claimed device family, not the host hardware.

#### Scenario: Family matrix answered per profile
- **GIVEN** a macOS M-series profile
- **WHEN** the availability promise resolves
- **THEN** it MUST resolve `true`
- **GIVEN** a legacy desktop family without platform-authenticator hardware
- **WHEN** the availability promise resolves
- **THEN** it MUST resolve `false`

### Requirement: Native Motion input domain (parity program 2026-09-07)
The engine patch MUST implement pointer and keystroke synthesis in the content input pipeline behind the wire contract defined by `add-motion-cdp-domain`, keeping command names, parameters, error codes, and hidden-domain semantics byte-stable across the swap.

#### Scenario: Contract stability across engine swap
- **GIVEN** an automation client speaking the Motion commands against the launcher-side handler
- **WHEN** the private engine with the native Motion domain replaces the launcher-side handler
- **THEN** the client MUST continue to operate without any protocol change
