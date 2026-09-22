# Recon — android-emulator-integration

## Inventory (read before designing; reuse > extend > create)

| Existing asset | Path | Reused as |
|---|---|---|
| Signed/verified download+extract pipeline, stale-download reclamation, error codes | `src/main/util/kernelAcquire.ts` | the pattern `packageManager.ts` follows (stream-hash-then-extract, `KernelAcquireError`-style `code`, `STALE_DOWNLOAD_MS`) |
| Movable data root + directory constants | `src/main/config.ts` (`DATA_DIR`, `PROFILES_DIR`) | engine dir `DATA_DIR/android`, overlays `PROFILES_DIR/<id>/android` |
| Column-additive migration helper | `src/main/db/schema.ts` (`ensureColumn`) | `profiles.android_config` |
| Profile row access | `src/main/profiles/profileManager.ts` (`getLiveProfile`, `ProfileRow`) | read-only from `android/config.ts` — **file frozen, not edited** |
| Deterministic mobile identity pool | `src/main/devices/mobilePresets.ts` (`MOBILE_PRESETS`, `pickMobilePreset`, `buildMobileUa`) | identity source for `android/fingerprint.ts`; no new pool invented |
| Proxy rows with geo + timezone | `proxies` table (`latitude`, `longitude`, `timezone` columns) | tun2socks target + GPS source (R11) |
| Route envelope + router style | `src/main/api/routes/diagnostics.ts`, mount list in `src/main/api/server.ts:286-305` | `routes/android.ts` |
| Renderer API client | `src/renderer/src/api.ts` (`request<T>()`) | Android methods |
| Renderer nav | `src/renderer/src/App.tsx` (`NAV_DESTINATIONS` + JSX branch) | one destination |
| Already-present deps | `ws`, `node-fetch`, `adm-zip`, `express`, `better-sqlite3`/sql.js | **no `npm install`** — `@yume-chan/scrcpy` deliberately not added (R17) |

## Decisions taken from the inventory

1. **The Android slice is separate from the browser slice.** Nothing in `launcher/`, `profiles/`,
   or `proxy/` gains an Android branch. This is what makes R18 provable: `resolveLaunchConfig`
   is not edited at all (`git diff` on `profileManager.ts` is empty).
2. **`browser_type` is the runtime selector** — it already exists and already holds `'chromium'`
   / `'firefox'`; adding `'android'` costs one string, not a new column.
3. **scrcpy is reimplemented, not vendored.** `@yume-chan/scrcpy` is a browser-targeted package
   with a large dependency tree; the wire format this change needs (12-byte header, flag bits in
   the top 2 bits of the pts, 12-byte codec meta) is ~120 lines and is unit-testable on both
   sides. This satisfies R17's audit requirement without an unverifiable dependency.

## Known limits, stated rather than hidden

- **Digests are pinned to SHA-1, not SHA-256.** Google's repository metadata
  (`repository2-3.xml`, `sys-img2-3.xml`) publishes `<checksum type="sha1">` only — there is no
  SHA-256 feed for these archives. Shipping `sha256: null` would have bricked acquisition, and
  fabricating a SHA-256 was never an option, so every shipped asset carries the published SHA-1
  verbatim (`AndroidAssetInfo.sha1`, used only when `sha256` is null). Real-archive verification:
  the downloaded `emulator-windows_x64-16349944.zip` (455342191 B) hashes to
  `99e809fc3e5e13bd5e552de24c7de79c6f911027` and `x86_64-34_r14.zip` (1510752654 B) to
  `01d32617fd1937e540faf8731d70cf50e35af854` — both exactly the pinned values. An asset with no
  digest at all still refuses with `ERR_ANDROID_DIGEST_UNPINNED` naming the file and URL; a test
  injects a digest-free table and asserts the refusal performs no network call.
- **The guest-side pieces require a booted image.** `tun2socks` inside the guest, the Magisk/Zygisk
  spoof module, and the Android-side binaries ship inside the AOSP image; the code here drives
  them over ADB and reports their absence instead of pretending they are present (`detectSpoofModule`,
  `InjectResult.errors`, `setupGuestNetwork().ok`).
- **Spoofing depth depends on guest privileges, and the code now says which it got.** Read-only
  `ro.*` properties and the goldfish/QEMU artefacts can only be rewritten with `adb root`
  (available on the `google_apis` image this change installs) or with Magisk's `resetprop`.
  `injectGuestIdentity` reports `privilege: 'full' | 'setprop-only'` rather than letting a
  partial application pass as a complete spoof, and `enableGuestRoot` is the enabling step.
- **The proxy path is enforced, not assumed.** A profile with no proxy gets its guest network
  actively cut (OUTPUT DROP, then interface/route removal as the unprivileged backstop) and a
  failure to apply either is reported as `ok: false`. A profile with a proxy gets a host-side
  SOCKS5 bridge on an ephemeral loopback port — the guest dials `10.0.2.2:<bridge port>`, and the
  bridge makes the authenticated upstream connection. `AndroidInstance.start()` refuses to reach
  `running` if either step fails, so a guest that could not be placed behind the proxy never runs.
- **`scrcpy-server.jar` is acquired like every other engine asset.** It is pinned by SHA-256
  (`93c272b7438605c055e127f7444064ed78fa9ca49f81156777fd201e79ce7ba3`, 69007 bytes, scrcpy v2.4)
  and installed through the same stream-verify-then-place path; the digest was computed from the
  real release asset and reproduced across two independent fetches. The server version passed to
  `app_process` is read from the same constant, so jar and invocation cannot drift apart.
- **A full cold boot cannot run in this environment** (no hypervisor image installed, ~800 MB
  download). Verification here is therefore: pure-function unit tests for the resolver, wire-format
  round-trip tests for both parsers, digest-refusal tests with an injected fetch, injection-plan
  tests against a fake ADB, plus typecheck of both projects and the pre-existing 146-test suite for
  R18. Any claim about a real boot is `[INFERENCE]` and is labelled as such.

## Acceptance check used for this change

`npx tsc -p tsconfig.main.json --noEmit` and `npm run typecheck:renderer` clean; `npm test` green
including the new suites; `git diff --stat` shows no modification to `src/main/profiles/` or
`src/main/launcher/`; `node D:/ohmypi/tools/archmap.mjs scan --root .` reports no new dependency
cycle.
