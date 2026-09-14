## Purpose

Defines the motion and orientation surfaces a phone-claiming profile must present, and the guarantee that desktop-claiming profiles are unaffected.

## ADDED Requirements

### Requirement: Mobile profiles expose handheld motion
A profile claiming a phone MUST expose accelerometer, gyroscope and orientation readings consistent with a handset being held. Readings MUST be deterministic for a given profile seed so a profile does not change character between sessions.

#### Scenario: Motion readings are handheld
- **GIVEN** a profile claiming a phone
- **WHEN** a page subscribes to `devicemotion`
- **THEN** it MUST receive readings consistent with a handheld device
- **AND** the readings MUST NOT present the host's absent-sensor state

#### Scenario: Determinism across sessions
- **GIVEN** the same phone-claiming profile
- **WHEN** it is launched twice
- **THEN** the sensor character MUST be the same both times

### Requirement: Desktop profiles are untouched
A profile claiming a desktop MUST leave sensor surfaces at stock browser behaviour on the host.

#### Scenario: No injected sensor behaviour
- **GIVEN** a profile claiming a Windows desktop
- **WHEN** a page probes sensor surfaces
- **THEN** the observed behaviour MUST equal stock browser behaviour on that host

### Requirement: Sensors agree with the claimed device
Sensor availability and orientation MUST agree with the rest of the profile's claimed identity.

#### Scenario: Orientation matches the claimed screen
- **GIVEN** a phone-claiming profile with a declared screen orientation
- **WHEN** a page reads orientation from the sensor surface and from `screen.orientation`
- **THEN** the two MUST agree

#### Scenario: Sensor permission matches availability
- **WHEN** a page queries the accelerometer permission on a phone-claiming profile
- **THEN** the answer MUST agree with the availability of the corresponding sensor constructor

### Requirement: Injection carries an engine-parity marker
Every sensor hook MUST be marked as an interim implementation so the eventual engine-owned implementation is traceable.

#### Scenario: Marker present
- **WHEN** the generated stealth script is inspected
- **THEN** each sensor hook MUST carry a `TODO(engine-parity: sensors)` marker
