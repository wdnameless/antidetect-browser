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
