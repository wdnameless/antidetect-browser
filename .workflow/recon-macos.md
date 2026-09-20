# Recon — macOS arm64 slice

What was inspected, what was measured, and what the measurements changed.

## Files touched

| File | Change |
|---|---|
| `src/main/util/kernelAcquire.ts` | `dmg` branch implemented (`extractDmg`); was `throw ERR_UNSUPPORTED_HOST_EXTRACTION` |
| `src-tauri/src/main.rs` | `portable_root_from_bundle`, `export_portable_root_if_bundled`, called first in `main()`; 3 tests; `test_env_lock` |
| `src-tauri/src/updater.rs` | 3 private env mutexes replaced by the shared lock |
| `tests/unit/kernelAcquire.test.ts` | 5 new cases for the dmg branch; `createMockFetch` hoisted |
| `tests/unit/portableState.test.ts` | isolation fix (reads the host's real %APPDATA% otherwise) |
| `.github/workflows/probe-macos-kernel.yml` | new: probe, acceptance and bundle-build jobs on `macos-14`/`macos-13` |
| `.github/workflows/ci.yml` | `release-macos` job; SDK build step before typecheck |
| `scripts/probe-macos-kernel.mjs` | new: measures the pinned image end to end |
| `scripts/e2e-macos-kernel.mjs` | new: real `ensureKernel` against the real image on macOS |
| `scripts/package-macos-portable.mjs` | new: the folder layout + `README-FIRST.txt`, archived with `ditto` |
| `scripts/vendor-node.mjs` | arm64 target added; both digests from nodejs.org's SHASUMS256.txt |
| `package.json` | `prebuild`/`pretypecheck` build the SDK |
| `README.md`, `docs/KERNEL.md` | measured results; disclosed limits |
| `openspec/changes/nulltrace-macos-arm64/` | proposal, spec, valid |

## Measurements that changed the design

1. **The kernel is native arm64.** `lipo -archs` on the extracted binary: `arm64`; `file`:
   `Mach-O 64-bit executable arm64`. Before this run the assumption was that the unsuffixed
   `…_macos.dmg` asset was x86_64 and would need Rosetta. It does not. Risk retired by measurement.
2. **Stealth holds on M1.** `navigator.webdriver === false` with CDP attached, and two seeds
   produced different surfaces (seed 2023 → `Apple M2`/24 cores, seed 4242 → `Apple M4`/16 cores,
   different canvas hashes). The flags are not silently ignored.
3. **The mount point is not fixed.** The probe recorded `/Volumes/Chromium`; a stale mount makes it
   `/Volumes/Chromium 1`, which is why the implementation parses the plist instead of assuming.
4. **The pinned `executableSubpath` is correct for the image.** `Chromium.app/Contents/MacOS/Chromium`
   exists after extraction — verified, not assumed.
5. **The bundle signs.** `codesign --verify --deep --strict` → SIGNATURE OK after the build, with
   Tauri re-signing the vendored Node runtime as a nested binary first.
6. **A pre-existing test race.** `cargo test` failed ~1 run in 3 before this work: three modules
   each held a private mutex around process-global env mutation. 12 consecutive runs pass after
   unifying it. Found by running the suite repeatedly, not by reading it.

## Failures found by running (and fixed)

- `mcp/src` imports `@antidetect/sdk`, whose `dist/` is gitignored and built only by the SDK's own
  build. `typecheck` and `build` both failed on a clean checkout; the Windows jobs masked it by
  ordering. `prebuild`/`pretypecheck` now make both commands self-sufficient.
- `ditto` given a basename failed; needs the full path.
- `lipo -archs` accepts one input; a glob errored and reported nothing.

## Acceptance evidence

- Run 35494974446 (`macos-14`): 11/11 probe steps OK.
- Acceptance job on `macos-14`: **12/12 checks passed** — real download, real digest, real hdiutil
  mount, real launch, `webdriver` false, quarantine cleared, no image left mounted.
- Bundle build on `macos-14`: succeeded; `SIGNATURE OK`.
- Windows side: `cargo test` 44 passed (12/12 runs), vitest 142 files / 1160 passed on a tree with
  `dist/`, `mcp/dist` and `packages/sdk-node/dist` deleted.

## Not verified

- Launching the `.app` on a real Mac with real profiles (CI builds the bundle; only a human can
  click it).
- Moving the `.app` between two physical Macs — macOS caches bundle paths and an ad-hoc signature
  may need re-signing. Recorded as a risk in the proposal.
- The macOS auto-update path: not implemented, deliberately not advertised.
