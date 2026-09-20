# Interfaces — macOS arm64 slice

Every boundary this change touches, its signature, and who owns it. The point is that two writers
can work in parallel without renegotiating anything: the contracts are fixed here.

## 1. Portable anchor (TypeScript) — owner: config

```ts
// src/main/config.ts — existing signatures, macOS semantics added. Signatures UNCHANGED.
export function isPortableMode(): boolean;
export function portableBaseDir(): string | null;
export function resolveDataDir(): string;
export function defaultDataDir(): string;
export function markDataRoot(dir: string): void;
export function dataDirHoldsData(candidateDir: string): boolean;
```

Contract: `portableBaseDir()` is the directory the operator's movable folder occupies — the parent
of `data/`, `settings.json`, `runtime/`, `webview/`. On Windows the launcher sets
`PORTABLE_EXECUTABLE_DIR="$EXEDIR"` and the shell lives inside `$EXEDIR/runtime/<version>/`.

On macOS the shell lives at `<root>/NullTrace.app/Contents/MacOS/NullTrace`. So the **caller that
sets the variable** — not `config.ts` — is responsible for exporting the ROOT, not the executable's
directory. `config.ts` must not start guessing bundle anatomy; it keeps consuming one env var.

New, single responsibility:

```ts
/** The portable root on macOS, derived from a path inside the bundle. Pure, testable. */
export function portableRootFromExecutable(executablePath: string): string | null;
// '…/NullTrace.app/Contents/MacOS/NullTrace' -> '…'
// null when the path is not inside a .app/Contents/MacOS layout
```

## 2. Shell anchor (Rust) — owner: src-tauri

```rust
// src-tauri/src/main.rs
pub fn default_settings_dir() -> PathBuf;      // unchanged signature
pub fn resolve_data_dir(settings_dir: &Path) -> PathBuf;  // unchanged signature
```

Contract: when `PORTABLE_EXECUTABLE_DIR` is absent but the running executable is inside a `.app`
bundle, the shell derives the root and exports it — so the backend, the webview directory and the
data directory all agree without a second convention. This mirrors what the NSIS launcher does on
Windows: one platform sets the variable, both consumers read it.

```rust
/// The root of a movable folder, for a macOS bundle. None off macOS or outside a bundle.
fn portable_root_from_bundle(exe: &Path) -> Option<PathBuf>;
// …/NullTrace.app/Contents/MacOS/NullTrace -> …  (three ancestors)
```

## 3. Kernel acquisition (TypeScript) — owner: kernelAcquire

```ts
export interface KernelAssetInfo {
  asset: string; size: number; sha256: string;
  archiveType: 'zip' | 'appimage' | 'tar.xz' | 'dmg';
  executableSubpath: string;
}
export function getPlatformAsset(platform?, assets?): KernelAssetInfo;
export function ensureKernel(opts?: EnsureKernelOptions): Promise<{ executablePath: string; kernelDir: string }>;
```

Contract unchanged. The `dmg` branch changes from "throw" to "extract", and must satisfy:

- `hdiutil attach -nobrowse -readonly -plist` — mount point parsed from plist, never assumed,
  because a stale mount makes it `/Volumes/Chromium 1`.
- The `.app` is copied out with `cp -R` (preserves the bundle's internal symlinks; a naive copy
  breaks the framework layout).
- `xattr -dr com.apple.quarantine` on the copied bundle before first launch, or the kernel is
  refused as a downloaded app.
- `hdiutil detach <mount> -force` in a `finally`, so a failure cannot leave a mounted image.
- Failures map to the existing codes: `ERR_UNSUPPORTED_HOST_EXTRACTION` (wrong host),
  `ERR_EXTRACTION_FAILED` (hdiutil/cp failed), `ERR_EXECUTABLE_NOT_FOUND` (subpath wrong for the
  image actually shipped — the macOS image nests the binary differently from the Windows zip, and
  the probe establishes the real path).
- The pinned digest check is untouched and stays fail-closed.

## 4. Release matrix (CI) — owner: ci.yml

Matrix entry, alongside the existing Windows one:

```yaml
- os: macos-14            # Apple Silicon (M1); macOS SDK only exists on macOS runners
  platform: mac
  artifact: NullTrace-macos-arm64
```

Contract: produces a zip containing `NullTrace.app` and the app passes `codesign --verify` after a
run (nothing written inside the bundle). The existing Windows job is untouched; a new matrix entry
must not change its artefact names or the updater manifest step, which is Windows-only.

## 5. Docs — owner: README + KERNEL.md

Must state, each backed by the probe's numbers: native or Rosetta; the Gatekeeper step; and the
Windows-only features that remain absent (measured-idle auto-lock, session-lock).

## Boundary summary

| Surface | Producer | Consumers | Fixed here |
|---|---|---|---|
| `PORTABLE_EXECUTABLE_DIR` | NSIS launcher (Win), shell (macOS) | config.ts, main.rs, updater.rs | value is the ROOT, never the exe's directory |
| `ensureKernel()` result | kernelAcquire | `api/routes/kernel.ts` | unchanged |
| Release artefact name | ci.yml | release job, docs | `NullTrace-<version>-macos-arm64.zip` |
