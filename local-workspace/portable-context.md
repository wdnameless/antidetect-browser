# Portable wave context — nulltrace-portable

## Goal
Installer-free distribution: one file to run on Windows and Linux, the honest macOS equivalent, the browser kernel acquired at run time instead of bundled, and a data location that makes a portable copy genuinely portable.

## User decisions (2026-09-14)
- **Runtime**: Electron `portable` target (keeps `safeStorage`/DPAPI, so secrets are untouched).
- **Kernel**: fetched on first run, NOT bundled. From the **upstream GitHub Releases** — no new CDN account.
- **Platforms**: Windows portable `.exe`, Linux `.AppImage`, macOS `.dmg` (macOS is NOT single-file; documented, matching the reference product).
- **Data**: prompted on first portable launch — "beside the executable" or "system location", remembered.
- **Delivery**: PR from `fix/ci-pipeline` → `main`; CI builds all three platforms.
- **Order**: portability first, monochrome noir redesign after.

## Verified facts (reconnaissance — trust these)
- `electron-builder` **26.15.3** is installed and supports the `portable` target. Today only `nsis` is configured — i.e. an installer, which the user explicitly does not want.
- Current build config: `appId: com.antidetect.browser` (KEEP — update continuity), `productName: NullTrace`, `win.target = nsis/x64`, **`mac` and `linux` are null**.
- `extraResources` currently bundles `data/chromium/fingerprint-chromium` (425 MB) → `kernel/fingerprint-chromium`, plus `resources/*.png`.
- **The kernel is already downloaded at build time**, not built: `scripts/ensure-kernel.mjs:17` fetches
  `https://github.com/adryfish/fingerprint-chromium/releases/download/148.0.7778.215/ungoogled-chromium_${KERNEL_VERSION}-1.1_windows_x64.zip`.
  It performs **no digest verification** today.
- **That upstream publishes every platform on the same tag, with SHA256 digests:**
  | Platform | Asset | Size | SHA256 |
  |---|---|---|---|
  | Windows | `ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip` | 189,767,686 | `9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579` |
  | Linux | `ungoogled-chromium-148.0.7778.215-1-x86_64.AppImage` | 188,811,768 | `a5fa5e6c05cb7fa3617ec2ca642ad3cc6e586ac5249cc29edb0a602d695685f0` |
  | Linux (tar) | `ungoogled-chromium-148.0.7778.215-1-x86_64_linux.tar.xz` | 141,269,020 | `70d239830332e5820aa34dfcb284161cac0429eee25da642830afe04bda717f4` |
  | macOS | `ungoogled-chromium_148.0.7778.215-1.1_macos.dmg` | 140,187,500 | `b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679` |
  Fetched via `https://api.github.com/repos/adryfish/fingerprint-chromium/releases/tags/148.0.7778.215`.
- Data resolution: `resolveDataDir()` (`src/main/config.ts:37`) order is **env override → saved setting in `settings.json` → `path.join(settingsBase(), 'data')`**. `DATA_DIR`/`DB_PATH`/`CHROMIUM_DIR` are **KEEP — data compatibility**; do not rename.
- Secrets: `src/main/util/secretStore.ts` uses a cipher **injected** by the Electron main process (`setSecretCipher`), DPAPI-backed on Windows. Keeping Electron means this is untouched.
- `kernelUpdate.ts` only *checks* the upstream version (read-only, uses `node-fetch`) — it does not download.
- Test baseline: **113 files / 890 tests green**, `npm run typecheck` clean.
- Branch is `fix/ci-pipeline`; CI (`.github/workflows/ci.yml`) has jobs `test` (windows-latest), `sdk` (matrix), `release` (windows-latest).

## Constraints
1. **Do not rename or move** `DATA_DIR`, `DB_PATH`, `CHROMIUM_DIR`, `HMAC_SECRET`, `SIGNING_DOMAIN_PREFIX`, `ANTIDETECT_*`, or `appId`. They carry data compatibility.
2. **Fail closed on verification.** A tampered or truncated kernel must be refused, never used.
3. Pin the upstream digests **in source with a comment** saying they are external and must be re-pinned when the version changes.
4. No new dependencies without reporting first. `node-fetch`, `adm-zip`, `zod` are available.
5. Run only your own test files. Never the full suite or a full build.
6. No `any`, no `@ts-ignore`.

## Return contract (≤25 lines)
```
STATUS: <done|partial|blocked>
FILES: <paths only>
TESTS: <file> — <N> tests, was X → now Y
INTERFACES: <public signatures added/changed>
REQUIREMENTS: <R-id mapping>
CONCERNS: <decisions needed, or files you needed but did not own>
```
