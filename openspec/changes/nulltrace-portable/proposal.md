## Why

The user wants the browser to launch as one file instead of being installed. Today
the only Windows target is `nsis` — an installer — and the patched Chromium kernel
(425 MB, `data/chromium/fingerprint-chromium`) is baked into the bundle through
`extraResources`, which is both why the artefact is enormous and why the same
configuration cannot ship cross-platform as a download.

Reconnaissance established three facts that make this cheaper than expected:

1. **`electron-builder` already supports a `portable` target** (v26.15.3 is
   installed) which yields a single self-extracting `.exe`. No new toolchain.
2. **The kernel is already fetched, not built.** `scripts/ensure-kernel.mjs:17` downloads
   `ungoogled-chromium_<version>-1.1_windows_x64.zip` from
   `github.com/adryfish/fingerprint-chromium/releases` — so the download path exists
   at build time and only needs to move to run time.
3. **That upstream publishes every platform with SHA256 digests** on the same tag
   (`148.0.7778.215`): `windows_x64.zip` (189 MB, `sha256:9ef3f471…`),
   `x86_64.AppImage` (188 MB, `sha256:a5fa5e6c…`),
   `macos.dmg` (140 MB, `sha256:b72f091e…`). The licence permits redistribution.
   **No new hosting account is required** — which was the only real blocker.

## What Changes

**Kernel download at run time.** The kernel stops being an `extraResources` payload
and becomes a first-run download from the upstream GitHub Releases, verified against
the published SHA256 before use. `kernelUpdate.ts` currently only *checks* the
version; it gains the download, verification, extraction and progress reporting. A
truncated or tampered download must fail closed, not launch a browser.

**Single-file artefacts.** Windows gains the `portable` target (replacing `nsis`);
Linux gains `AppImage`; macOS gains `dmg`. The `.exe` the user runs is one file.

**Portable data mode.** On first launch the operator chooses whether data lives
beside the executable (fully portable — the point of the request) or in the system
location, and the choice is remembered.

**CI builds all three.** Linux and macOS artefacts require those operating systems,
so the release job is the only path to them. Delivered as a PR from the current
branch.

## Capabilities

### New Capabilities
- `portable-distribution`: single-file artefacts, first-run kernel acquisition, and the portable data mode.

### Modified Capabilities
- `parity-baseline`: the release matrix gains installer-free artefacts.

## Impact

- `package.json` build config, `scripts/ensure-kernel.mjs`, `src/main/util/kernelUpdate.ts`,
  new kernel-download module, `src/main/config.ts` (data-mode resolution),
  `.github/workflows/ci.yml`, new release workflow.
- Tests: download verification (including a tampered-digest rejection), data-mode
  resolution, and artefact-shape assertions.

### Goals

- One file to run on Windows and Linux; the smallest honest macOS story.
- The kernel arrives over the network and is verified before it can be used.
- No new hosting, no new accounts, no code signing.

### Non-Goals

- No Apple Developer account, no notarization — macOS stays unsigned with the
  documented quarantine step, exactly as the reference product does.
- No move away from Electron; the portable build keeps `safeStorage`/DPAPI, so
  existing credentials keep working (R48).
- No monochrome redesign in this program (R51i) — portability first.
- No new CDN account (R47).

### Risks and commitments

- **Upstream dependency.** The kernel comes from a third-party GitHub account. If
  those releases vanish, first-run acquisition breaks. Recorded as an accepted risk;
  the mitigation is that the digest list is pinned in our source, so a missing
  release fails loudly rather than silently fetching something else.
- **First run needs a network.** A machine with no internet cannot acquire the
  kernel. This is inherent to R46 and is disclosed in the UI rather than papered over.
- **macOS is not single-file.** Stated plainly; `.dmg` plus the quarantine step is
  what the reference product ships too.
- **CI is the only path for Linux/macOS.** Those artefacts cannot be produced or
  verified on this Windows host.
- **`nsis` removal is a release-continuity change.** Existing installed users must
  be able to move to the portable artefact; `appId` therefore stays unchanged.
