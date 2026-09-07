## Why

JavaScript injection wrappers (`evaluateOnNewDocument`, Object.defineProperty, Proxy) leave observable detection vectors in modern browser fingerprinting tests (CreepJS, Pixelscan, BrowserLeaks). Antidetect evasion requires moving beyond user-space JavaScript shims to native engine-level modifications in Chromium and Blink C++ source code.

This change establishes native C++/Blink engine hardening:
1. Native font enumeration filtering directly in `FontCache` / `FontPlatformData`.
2. Native WebGL parameter overriding without intercepting `getParameter` in JavaScript context.
3. Native Canvas noise injection in `ImageBuffer::ToDataURL` / `CanvasRenderingContext2D`.
4. Native Client Rects sub-pixel perturbation in Blink layout calculations.
5. Removal of `navigator.webdriver` directly in Blink C++ binding generation (`NavigatorAutomationInformation.idl`).
6. Native memory/CPU hardware concurrency reporting directly in V8 system query bridges.
7. WebGPU adapter and limits spoofing in the Dawn/device layer (`navigator.gpu.requestAdapter`) — the host GPU must never surface.
8. WebAuthn platform-authenticator availability matching the claimed device (`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable`).
9. Native Motion input domain (supersedes the launcher-side Motion handler of `add-motion-cdp-domain`): pointer trajectories and keystrokes synthesized in the input pipeline.
## What Changes

- Defined architecture and specifications for Chromium source-level patch-sets across Blink, V8, and Content modules.
- Defined compile-time flag and runtime command-line switches (`--stealth-engine-profile=<id>`) passing profile-specific hardware and fingerprint masks directly to the C++ core.
- Strict requirement: No prototype tampering or JavaScript wrappers permitted for engine-level core primitives.
- Deterministic seed-based noise generation directly in C++ rendering pipes.
- Extended surfaces (2026-09-07 parity program): WebGPU adapter/limits, WebAuthn platform authenticator, native Motion input; each ships a JS-interim fallback in the launcher marked `TODO(engine-parity)` until the private-engine patch lands, per `interim-stealth-hardening` rules.

## Capabilities

### New Capabilities
- `engine-level-hardening`: Native C++/Blink source modifications, patch sets, compile-time flags, and direct hardware masking without JS shims.

### Modified Capabilities
None.

## Impact

- `patches/chromium/`: Dedicated patch-set repository for Chromium/Blink build targets.
- Launcher runtime: CLI flags passing profile fingerprint descriptors directly to the browser binary.
