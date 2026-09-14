## Why

A verified defect: a profile claiming a phone exposes no motion-sensor surface at all. `DeviceMotion`, `DeviceOrientation`, `Sensor`, `Accelerometer` and `setSensorOverride` have zero occurrences in `src/`. A single probe distinguishes a real handset from our mobile profile, which defeats the purpose of mobile profiles — the catalog ships phone families (`mobilePresets.ts`, 30 Android models) precisely so a profile behaves like a handset.

ShardX documents the behaviour this slice must match: a profile claiming a phone reports a device being held, screen orientation follows the claimed screen, and orientation can be turned over the debugging port.

## What Changes

- `stealthNoise.ts`: `resolveSensorConfig(opts)` producing a deterministic per-profile sensor profile (handheld jitter, gravity-consistent acceleration, orientation matching the claimed screen).
- `stealthInjection.ts`: hook `DeviceMotionEvent` and `DeviceOrientationEvent` construction and their event delivery, the `Sensor`-family constructors (`Accelerometer`, `Gyroscope`, `Magnetometer`, `LinearAccelerationSensor`, `GravitySensor`), and `navigator.permissions.query` for the sensor permission names.
- Non-mobile profiles MUST be untouched: the hooks are emitted only when the profile claims a phone.

## Scope boundary

This is the injection-layer surface, marked `TODO(engine-parity: sensors)` alongside the existing markers. It does not claim kernel-level sensor emulation.

## Capabilities

### New Capabilities
- `mobile-sensors`: handheld motion and orientation surfaces for phone-claiming profiles.

### Modified Capabilities

None.

## Impact

- `src/main/proxy/stealthInjection.ts`, `src/main/proxy/stealthNoise.ts`, `tests/unit/stealth/mobileSensors.test.ts`.
