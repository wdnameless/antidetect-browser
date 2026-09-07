## 1. Blink IDL & Automation Info Hardening

- [ ] 1.1 Remove `navigator.webdriver` from `NavigatorAutomationInformation.idl` and Blink binding templates.
- [ ] 1.2 Wire native profile properties directly into `NavigatorConcurrentHardware.cpp` and `NavigatorDeviceMemory.cpp`.
- [ ] 1.3 Verify `Object.getOwnPropertyDescriptor` and prototype introspection tests report native code without JS wrapper signatures.

## 2. Native Font Enumeration Filtering

- [ ] 2.1 Implement font whitelist filter in `FontCache::CreateFontPlatformData`.
- [ ] 2.2 Add C++ unit test ensuring non-whitelisted fonts return `nullptr` and fail font existence probes.

## 3. Native Rendering & Layout Perturbation

- [ ] 3.1 Hook `ImageBuffer::ToDataURL` in `third_party/blink/renderer/platform/graphics/` to inject seeded sub-pixel noise.
- [ ] 3.2 Implement WebGL vendor/renderer masking directly in `WebGLRenderingContextBase::getParameter`.
- [ ] 3.3 Apply deterministic sub-pixel rect drift in `Element::getBoundingClientRect`.

## 4. Chromium Command-line Interface

- [ ] 4.1 Implement `--stealth-engine-profile=<id>` switch in Chromium startup argument parser.
- [ ] 4.2 Verify CreepJS, Pixelscan, and BrowserLeaks test suites pass with 100% native trust scores.

## 5. WebGPU adapter spoofing (parity program 2026-09-07)

- [x] 5.1 JS-interim: hook `navigator.gpu.requestAdapter` in `stealthInjection.ts` returning the profile family's adapter info (vendor, architecture, device, features, limits) with native-code `toString` integrity per `interim-stealth-hardening`; mark `TODO(engine-parity: webgpu-dawn)`.
- [x] 5.2 Engine patch spec: Dawn/device-layer adapter substitution gated by `--stealth-engine-profile`; document patch-set file targets for the private-engine build chain. (spec row documented in design.md §5; implementation deferred to the private-engine chain)
- [x] 5.3 Tests: adapter response matches profile family GPU for windows/macos/linux families; `requestAdapterInfo()` fields coherent with WebGL renderer; absent-gpu profiles resolve `undefined` like real Linux Chrome. (`tests/unit/stealth/engineSurfaces.test.ts`)

## 6. WebAuthn platform authenticator (parity program 2026-09-07)

- [x] 6.1 JS-interim: hook `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable` returning `true` only for profile families whose claimed device ships a platform authenticator; mark `TODO(engine-parity: webauthn)`.
- [x] 6.2 Engine patch spec: native availability response gated by `--stealth-engine-profile`; document Blink/WebAuthn patch targets. (spec row documented in design.md §6; implementation deferred to the private-engine chain)
- [x] 6.3 Tests: availability matrix across families (macOS M-series true, old desktop families false, matching real-device behavior). (`tests/unit/stealth/engineSurfaces.test.ts`)

## 7. Native Motion input domain (parity program 2026-09-07)

- [ ] 7.1 Engine patch spec: native Motion domain in the input pipeline (pointer trajectories, keystroke synthesis, per-profile motor seeds from `--stealth-engine-profile` config) superseding the launcher-side handler from `add-motion-cdp-domain` once the private engine lands; document patch targets. (spec row documented in design.md §7; implementation deferred to the private-engine chain)
- [ ] 7.2 Launcher contract stability: the launcher-side handler keeps command names, parameters, and error codes byte-stable so the engine patch is a drop-in swap; hidden-domain requirement (`add-motion-cdp-domain` spec) carries over unchanged. (contract owned by `add-motion-cdp-domain`; enforce at engine-patch time)