# Design: Native Engine-Level Hardening (Chromium & Blink C++)

## Context and Scope

Advanced anti-bot systems detect JavaScript prototypes, `toString()` tampering, proxy wrappers, and timing discrepancies introduced by extension- or script-based evasions. Achieving indistinguishable parity requires native patch sets in Chromium source code (Blink layout engine, Content module, and V8 engine).

## Architecture & Subsystems

```
┌─────────────────────────────────────────────────────────┐
│                     Profile Config                      │
│        (--fingerprint-config=/path/to/profile.json)     │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                 Chromium C++ Core                      │
│                                                         │
│  ┌───────────────────────┐   ┌───────────────────────┐  │
│  │   Blink Layout & DOM  │   │     Rendering & 2D    │  │
│  │  - Navigator (No JS)  │   │  - ImageBuffer Noise  │  │
│  │  - FontCache Filter   │   │  - WebGL Parameter    │  │
│  │  - Subpixel Rect Off  │   │    Overrides          │  │
│  └───────────────────────┘   └───────────────────────┘  │
│  ┌───────────────────────┐   ┌───────────────────────┐  │
│  │       V8 Engine       │   │     Content Module    │  │
│  │  - Hardware Concur    │   │  - Client Hints Sync  │  │
│  │  - Device Memory      │   │  - Network Stack Host │  │
│  └───────────────────────┘   └───────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Key Decisions

1. **Eliminate All JS Injection Wrappers for Core Identifiers**:
   - `navigator.webdriver`: Stripped in Blink IDL binding generation (`NavigatorAutomationInformation.idl`).
   - `navigator.hardwareConcurrency`: Directly returns profile integer in `NavigatorConcurrentHardware.cpp`.
   - `navigator.deviceMemory`: Directly returns profile float in `NavigatorDeviceMemory.cpp`.
2. **Native Font Enumeration in C++**:
   - Hooked inside `FontCache::CreateFontPlatformData` to enforce allowed font whitelist. Unallowed system fonts return `nullptr` as if absent from OS.
3. **Deterministic Canvas & WebGL Subsystem Hooks**:
   - `ImageBuffer::ToDataURL` and `WebGLRenderingContextBase::getParameter` read masked values directly from memory cache initialized via `--stealth-engine-profile`.
   - Noise algorithm uses a seeded MurmurHash3 generator per canvas element to remain idempotent per render while resisting statistical reverse-engineering.
4. **Layout Rects Perturbation**:
   - `Element::getBoundingClientRect` in `third_party/blink/renderer/core/dom/element.cc` applies sub-pixel drift ($10^{-5}$ px) based on profile seed.
5. **WebGPU Adapter Spoofing (parity program 2026-09-07)**:
   - JS-interim: `navigator.gpu.requestAdapter` resolves a synthesized `GPUAdapter` whose `requestAdapterInfo()` returns the profile family's GPU (vendor/architecture/device), with feature/limit sets curated per family in the fingerprint catalog; `toString` integrity per `interim-stealth-hardening`. Marked `TODO(engine-parity: webgpu-dawn)`.
   - Engine patch: adapter selection intercepted in the Dawn device creation path; the physical device is substituted by the profile's claimed adapter with family-matching limits, gated by `--stealth-engine-profile`. Profiles whose family has no WebGPU (real Linux Chrome) resolve `undefined`.
6. **WebAuthn Platform Authenticator (parity program 2026-09-07)**:
   - JS-interim: `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable` resolves per-family truth matrix (macOS M-series: true; legacy desktops without Hello/TouchID-era hardware: false). Marked `TODO(engine-parity: webauthn)`.
   - Engine patch: availability answered in the Blink authenticator module from the profile config, so no JS surface exists at all.
7. **Native Motion Input (parity program 2026-09-07)**:
   - Engine patch: pointer trajectory and keystroke synthesis implemented in the content input pipeline reading per-profile motor seeds from the `--stealth-engine-profile` config; the launcher-side handler (`add-motion-cdp-domain`) defines the wire contract and is superseded in place — command names, parameters, error codes, and hidden-domain semantics stay byte-stable across the swap.

## Migration and Validation

- Launcher adds `--stealth-engine-profile=<id>` switch when executing custom Chromium binary.
- Existing extension-based JS shims are disabled when engine-level profile execution is active.
- Parity-program extension (2026-09-07): until the private-engine build chain lands, surfaces 5–7 ship as JS-interim hooks under `interim-stealth-hardening` rules (native `toString`, explicit `TODO(engine-parity)` markers); the engine patch replaces each hook without API-visible change.
