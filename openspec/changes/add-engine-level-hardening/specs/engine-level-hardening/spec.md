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
