# Android emulator integration

## Why

Every profile this product runs today is a **desktop** browser: a Chromium binary with a
spoofed fingerprint, launched into an OS window. That covers desktop web. It does not cover
the mobile web, and the difference is no longer cosmetic — a large share of the sites an
operator works with serve a different application to a phone, and a desktop UA with a
narrow viewport is detected as exactly that.

The operator asked for a real Android runtime integrated into the product, with the
architecture frozen first: headless AOSP QEMU, an in-app canvas instead of a native window,
hardware/network spoofing deep enough to survive integrity checks, and a small installer
that downloads the heavy parts on demand. The architecture document
(`docs/ANDROID_EMULATOR_ARCHITECTURE.md`) records the decisions and the five stages. This
change implements stage 1 through stage 4 of that document.

## What Changes

- **New vertical slice `src/main/android/`.** The Android runtime is isolated from the
  existing browser slice: nothing in `launcher/`, `profiles/`, or `proxy/` gains Android
  branching. The slice owns the platform resolver, the package downloader, the emulator
  process, the ADB bridge, the scrcpy stream host, the spoof injector and the tun2socks
  wiring.
- **Platform resolver.** One code path resolves the host hypervisor and the matching system
  image: WHPX/AEHD on Windows (`x86_64`), HVF on macOS (native `arm64-v8a` on Apple
  Silicon, `x86_64` on Intel), KVM on Linux. Unsupported hosts produce an actionable error.
- **On-demand acquisition.** `ensureAndroidEngine()` pins asset URLs and their published
  digests (the pattern already proven by `kernelAcquire.ts`): it downloads the emulator tools
  and the base system image into `DATA_DIR/android/`, verifies each digest by streaming the
  hash, extracts, and removes stale partial downloads. Verification is algorithm-aware —
  SHA-256 when the vendor pins one, otherwise the SHA-1 Google's repository metadata actually
  publishes — and a digest mismatch deletes the payload and fails closed.
- **Headless instance lifecycle.** `AndroidInstance` spawns `emulator -no-window` with the
  profile's own `userdata.img` over the shared read-only base, waits for `sys.boot_completed`
  over ADB, keeps a QEMU snapshot so a warm start is seconds rather than a cold boot, and
  tears the process tree down on stop.
- **In-app screen.** `AndroidStreamHost` pushes `scrcpy-server.jar`, forwards the ADB
  socket, and relays the H.264 stream plus the control channel over a loopback WebSocket.
  The renderer's `AndroidCanvas` decodes it with WebCodecs and draws to a canvas; pointer
  events become touch events; a toolbar exposes Back/Home/Recents/Power/Rotate.
- **Mobile identity.** A profile gains `type` (`desktop` | `android`). For an Android
  profile the existing deterministic mobile preset pool is the identity source, and an
  injector writes `build.prop` properties, Android ID, IMEI, serial and MAC into the guest
  over ADB before the profile is handed to the operator.
- **Network isolation.** The guest's traffic enters a `tun0` interface served by the
  bundled tun2socks client, which forwards TCP and UDP to the profile's existing proxy
  configuration. GPS coordinates are pushed to the emulator controller from the proxy's
  known geolocation.
- **New routes.** `src/main/api/routes/android.ts` exposes engine status/install, instance
  start/stop, and a stream ticket. The renderer client gains the matching methods.

## Impact

- Affected specs: `android-runtime` (new), `mobile-profile` (new), `profile-lifecycle`
  (modified: a profile may now be `android`).
- Affected code: new `src/main/android/**`, new `src/renderer/src/components/AndroidCanvas.tsx`,
  new `src/renderer/src/pages/Android.tsx`, one migration in `src/main/db/schema.ts`, one
  router mount in `src/main/api/server.ts`, additions to `src/renderer/src/api.ts` and
  `App.tsx`.
- Unchanged: `src/main/launcher/**`, `src/main/proxy/**` (only *read* by the new slice),
  every existing route.
