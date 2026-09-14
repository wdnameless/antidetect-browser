## 1. Sensor model

- [ ] 1.1 `resolveSensorConfig(opts)` in `stealthNoise.ts`: deterministic from the profile seed; returns `null` for non-mobile profiles. Unit tests: mobile resolves a config, desktop resolves `null`, two seeds diverge.
- [ ] 1.2 Sensor profile shape: gravity-consistent acceleration, handheld jitter amplitude, orientation matching the family's claimed screen orientation, and rotation capability for `screen.orientation`.

## 2. Injection

- [ ] 2.1 Emit `sensors` into `CFG` only when mobile; emit nothing otherwise.
- [ ] 2.2 Hook `DeviceMotionEvent` and `DeviceOrientationEvent`: constructor availability, `requestPermission` on platforms that expose it, and periodic event delivery with coherent readings.
- [ ] 2.3 Hook the `Sensor` family constructors so they exist and start delivering readings rather than throwing or being absent.
- [ ] 2.4 `navigator.permissions.query` answers the sensor permission names consistent with the constructors' availability.
- [ ] 2.5 `screen.orientation` agrees with the sensor profile.
- [ ] 2.6 Mark every hook `TODO(engine-parity: sensors)`.

## 3. Verification

- [ ] 3.1 Test: a phone-claiming profile yields motion readings consistent with a handheld device.
- [ ] 3.2 Test: a desktop-claiming profile leaves sensor surfaces at host behaviour (no injected config).
- [ ] 3.3 Test: sensor readings agree with the profile's claimed orientation.
- [ ] 3.4 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-mobile-sensors --strict`.
