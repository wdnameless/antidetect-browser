## Purpose

Defines how a profile presents a font inventory coherent with the device it claims, across every surface a page can measure.

## ADDED Requirements

### Requirement: Profile-coherent font inventory
The launcher MUST resolve each profile's font inventory from its fingerprint family and deliver it to the browser layer. A family that declares no inventory MUST fall back to its platform's default set rather than to an empty list.

#### Scenario: Family inventory reaches the browser layer
- **GIVEN** a profile derived from a macOS family
- **WHEN** the profile launches
- **THEN** the resolved font inventory MUST be the family's declared set
- **AND** MUST NOT be an empty list

#### Scenario: Distinct families produce distinct inventories
- **WHEN** two profiles from different platform families are launched
- **THEN** their resolved inventories MUST differ on the platform-defining families

### Requirement: Host fonts are not observable
A page MUST NOT be able to determine that a font exists only because the host machine has it.

#### Scenario: Host-only font is hidden
- **GIVEN** a macOS-claiming profile on a Windows host
- **WHEN** a page probes for `Segoe UI`
- **THEN** the probe MUST NOT report it as available

#### Scenario: Windows font is hidden from a Linux-claiming profile
- **GIVEN** a Linux-claiming profile on a Windows host
- **WHEN** a page probes for `Segoe UI`, `Calibri` or `Consolas`
- **THEN** none MUST report as available

### Requirement: Declared fonts measure as present
A family the profile declares must behave as it would on a machine that has that font, even when the host lacks it — because a phone profile reporting no phone fonts is itself anomalous.

The concrete test is the standard presence probe: measure a probe string in the target family, measure it in a known-different fallback family, and compare. A page MUST observe the two widths differing for a declared family, exactly as it would on the claimed device. Returning the fallback font's width for both is the "absent" answer and violates this requirement.

#### Scenario: Presence probe reports declared family as present
- **GIVEN** a profile declaring `SF Pro`, absent from the host
- **WHEN** a page measures a probe string in `"SF Pro", monospace` and compares it with `monospace`
- **THEN** the two widths MUST differ, as they would on a machine that has `SF Pro`
- **AND** the result MUST NOT equal the plain fallback measurement

#### Scenario: Measurement is stable across calls
- **WHEN** the same declared family is measured repeatedly in one session
- **THEN** the result MUST be identical each time

#### Scenario: Declared family is not affected by the hidden set
- **GIVEN** a family that appears in both the declared inventory and the host's fonts
- **WHEN** a page measures it
- **THEN** it MUST measure as present, not as hidden

### Requirement: Local font enumeration is not fabricated
The implementation MUST NOT introduce a browser surface that stock Chrome lacks. Stock Chrome exposes no `navigator.fonts` object; Local Font Access is reached through `window.queryLocalFonts()`. Adding a `navigator.fonts` object is therefore itself a detectable tell and is forbidden.

`window.queryLocalFonts` MUST remain present and MUST reject with a `NotAllowedError`-shaped error when the font-access permission has not been granted. It MUST NOT resolve to the declared inventory.

#### Scenario: No fabricated surface
- **GIVEN** a profile on any platform
- **WHEN** a page inspects `navigator` for a `fonts` property
- **THEN** the result MUST match stock Chrome for that platform
- **AND** the implementation MUST NOT define `navigator.fonts`

#### Scenario: Ungranted call rejects
- **GIVEN** a profile without the font-access permission
- **WHEN** a page calls `window.queryLocalFonts()`
- **THEN** the promise MUST reject with a `NotAllowedError`-shaped error
- **AND** MUST NOT resolve to the declared inventory

### Requirement: Mobile and desktop inventories differ
A profile claiming a phone MUST present a handset's font set; a profile claiming a desktop MUST present that desktop's.

#### Scenario: Phone and desktop diverge
- **WHEN** a phone-claiming profile and a Windows-claiming profile are compared on the same host
- **THEN** their observable font inventories MUST correspond to the phone and the desktop respectively
