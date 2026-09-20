## Why

The operator asked whether the portable build can work on a Mac:

> Так теперь я хочу, чтобы наша порта была версия работала на маке. Это возможно?

It is possible, with one honest caveat that has to be measured rather than assumed. Reconnaissance
found:

1. **The kernel already exists for macOS and is already pinned.** `kernelAcquire.ts:27` pins
   `ungoogled-chromium_148.0.7778.215-1.1_macos.dmg` (140 MB, `sha256:b72f091e…`) with the right
   executable subpath. The upstream release this project already depends on publishes a macOS
   image on the same tag — verified against the GitHub API in this session, not taken from docs.

2. **But the extraction branch for it was never written.** `kernelAcquire.ts:199` throws
   `ERR_UNSUPPORTED_HOST_EXTRACTION` for `archiveType: 'dmg'` with the comment "requires manual
   mount or hdiutil workflow". So the asset is pinned, unreachable, and the platform it was pinned
   for has never run.

3. **Everything else is already platform-gated and compiles for macOS.** `resolve_node_path` has a
   `#[cfg(target_os = "macos")]` arm for the sidecar Node binary; `secrets.rs` degrades to a
   documented error off Windows; `screen.rs` is an explicit no-op off Windows; the sidecar's
   job-object guarantee is `#[cfg(target_os = "windows")]` with no macOS equivalent, which is a
   real gap rather than a cosmetic one. `tauri.conf.json` already carries
   `macOS.signingIdentity: "-"` (ad-hoc) and `minimumSystemVersion: 10.13`.

4. **The one architectural unknown is the kernel's architecture.** The pinned asset is named
   `…_macos.dmg` with no arch suffix, in a release matrix that names `windows_x64` and
   `x86_64.AppImage` explicitly. The operator chose Apple Silicon, where an unsigned arm64 binary
   cannot execute at all and an x86_64 one needs Rosetta 2. Whether the pinned image is native
   arm64 or x86_64-only is the deciding fact for this whole change, and it cannot be determined
   from a Windows host. `.github/workflows/probe-macos-kernel.yml` therefore measures it on a real
   M1 (`macos-14`), with `macos-13` as the native-x86_64 control.

**This change is gated on that probe.** The spec below states what is required; the design of the
kernel branch follows whatever the probe reports, and if the kernel proves unusable on arm64 the
slice narrows to "the application runs, the browser kernel does not" — reported, not papered over.

## What Changes

**A macOS arm64 artefact.** Tauri already builds `app`/`dmg` bundles on macOS; the release matrix
gains a `macos-14` entry so the artefact is produced where its SDK exists. Windows cannot
cross-compile to macOS.

**Portable form: the bundle plus a data folder beside it.** The operator chose
`NullTrace.app` + `data/`. Data is resolved by the same portable rule that already works on
Windows (`PORTABLE_EXECUTABLE_DIR` → `settingsBase()`), but the anchor differs: on macOS the
executable lives at `NullTrace.app/Contents/MacOS/NullTrace`, so the portable root is three
levels up. Nothing is ever written inside the `.app` — that would invalidate the ad-hoc signature
and macOS would refuse the modified bundle.

**The dmg branch of kernel acquisition is implemented.** Mount with `hdiutil attach -nobrowse
-readonly -plist` (the mount point is parsed, not assumed), copy the `.app` out preserving
symlinks, clear the quarantine attribute, and resolve the executable inside it. Verification stays
exactly as it is: SHA-256 against the pinned digest, fail closed.

**Documentation states what was measured.** Native versus Rosetta, the one-time Gatekeeper step,
and the Windows-only features that stay absent.

## Capabilities

### New Capabilities
- `macos-portable-distribution`: the arm64 artefact, the bundle-plus-data portable layout, macOS
  kernel acquisition, and the disclosed platform limitations.

### Modified Capabilities
- `portable-distribution`: "each platform ships in its native single-file form" gains the macOS
  case as a folder rather than a file, with the reason stated.

## Impact

- `src/main/util/kernelAcquire.ts` — the `dmg` branch, and the portable root rule.
- `src/main/config.ts` — portable base directory on macOS (the `.app` anchor).
- `src-tauri/src/main.rs` — the portable webview directory, and the sidecar lifecycle gap where
  Windows uses a job object and macOS has nothing.
- `.github/workflows/ci.yml` — the `macos-14` release matrix entry.
- `scripts/build-portable.mjs` — a macOS path (zip of the `.app` plus the layout), or a sibling
  script; the NSIS launcher itself is Windows-only and stays so.
- `README.md`, `docs/KERNEL.md` — the measured findings and the disclosed limits.

### Goals

- The application runs on Apple Silicon from a folder that can be moved, with profiles intact.
- The kernel is acquired and verified on macOS the same way it is on Windows.
- Every limitation is stated with the measurement behind it.

### Non-Goals

- No universal/fat binary and no Intel artefact (the operator chose arm64; Intel appears only as a
  probe control).
- No notarization or Developer ID (no Apple account, as recorded for this project already).
- No macOS auto-update. The portable swap helper is a Windows mechanism
  (`build_windows_swap_command`); a `.app` equivalent is its own decision and is not implied here.
- No Mac App Store distribution.
- No change to how Windows ships.

### Risks and commitments

- **The kernel may be x86_64-only.** Then arm64 runs it under Rosetta 2, which is a detection
  surface this project cannot currently measure and would have to disclose as such. The probe
  decides which of these is true; the docs will carry the answer, not a hope.
- **Ad-hoc signing means Gatekeeper blocks a quarantined bundle.** One documented `xattr` step,
  same as the reference product.
- **The sidecar has no kill-on-close guarantee off Windows.** On Windows a job object guarantees
  the backend dies with the shell even on a hard kill; on macOS nothing enforces it, so a crashed
  shell can leave an orphaned backend holding the port. This is a real gap that this change must
  either close (`process_group` + explicit teardown) or state.
- **A moved `.app` changes its own path.** macOS caches the bundle path; a relocated app may need
  a re-sign (ad-hoc, local) or fail Gatekeeper's path check. Verified on the probe machine, not
  assumed.
