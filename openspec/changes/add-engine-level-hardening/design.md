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

## Migration and Validation

- Launcher adds `--stealth-engine-profile=<id>` switch when executing custom Chromium binary.
- Existing extension-based JS shims are disabled when engine-level profile execution is active.
