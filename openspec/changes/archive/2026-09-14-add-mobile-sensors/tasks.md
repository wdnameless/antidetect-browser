## 1. Sensor model

- [x] 1.1 `resolveSensorConfig(opts)` in `stealthNoise.ts`: deterministic from the profile seed; returns `null` for non-mobile profiles. Unit tests: mobile resolves a config, desktop resolves `null`, two seeds diverge.
- [x] 1.2 Sensor profile shape: gravity-consistent acceleration, handheld jitter amplitude, orientation matching the family's claimed screen orientation, and rotation capability for `screen.orientation`.

## 2. Injection

- [x] 2.1 Emit `sensors` into `CFG` only when mobile; emit nothing otherwise.
- [x] 2.2 Hook `DeviceMotionEvent` and `DeviceOrientationEvent`: constructor availability, `requestPermission` on platforms that expose it, and periodic event delivery with coherent readings.
- [x] 2.3 Hook the `Sensor` family constructors so they exist and start delivering readings rather than throwing or being absent.
- [x] 2.4 `navigator.permissions.query` answers the sensor permission names consistent with the constructors' availability.
- [x] 2.5 `screen.orientation` agrees with the sensor profile.
- [x] 2.6 Mark every hook `TODO(engine-parity: sensors)`.

## 3. Verification

- [x] 3.1 Test: a phone-claiming profile yields motion readings consistent with a handheld device.
- [x] 3.2 Test: a desktop-claiming profile leaves sensor surfaces at host behaviour (no injected config).
- [x] 3.3 Test: sensor readings agree with the profile's claimed orientation.
- [x] 3.4 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-mobile-sensors --strict`.
