// GPU backend selection for the patched kernel.
//
// The kernel this product ships (`fingerprint-chromium`, an ungoogled Chromium build) does NOT
// fall back the way stock Chrome does when its GPU decision goes the wrong way. Measured on
// this host — Intel HD 530 visible in WMI, no driver-reachable D3D path:
//
//   stock chrome,  no switches            -> WebGL  ANGLE (Microsoft, ... Basic Render Driver)
//   stock chrome,  --headless=new         -> WebGL  ANGLE (Microsoft, ... Basic Render Driver)
//   kernel,        no switches            -> webgl2/webgl = NULL, headful AND headless
//   kernel,        --use-angle=d3d11      -> NULL   (forcing the hardware path does not help)
//   kernel,        --ignore-gpu-blocklist -> WebGL  ANGLE (Microsoft, ... Basic Render Driver)
//   kernel,        --use-angle=warp       -> WebGL  ANGLE (Microsoft, ... Basic Render Driver)
//
// A null WebGL context is not a cosmetic gap. Every anti-bot script reads it, no real browser
// reports it, and it was the single loudest automation tell the product had.
//
// Why `--ignore-gpu-blocklist` and not a forced software rasteriser: WARP and
// `--use-angle=swiftshader` both produce a context here, but both PIN the rasteriser. On a
// machine whose GPU actually works that would report a software renderer where the host has
// hardware — trading one incoherence for another, on every profile. Ignoring the blocklist
// only widens what Chromium is allowed to pick: it keeps the real GPU wherever one works and
// falls back to software when it does not, which is what stock Chrome does on its own.
//
// Presence of an adapter in WMI is NOT evidence the D3D path works — measured and disproved
// above. That is why there is no "has a GPU?" branch here: the failing hosts report a GPU.

/** Switch that restores a WebGL context on the shipped kernel. */
export const GL_FALLBACK_FLAGS: readonly string[] = ['--ignore-gpu-blocklist'];

/**
 * GPU switches for a launch.
 *
 * Always returns the fallback set. A conditional here would leave exactly the machines that
 * motivated this module with a null WebGL context, because they are the ones that advertise a
 * GPU. An operator can still override: per-profile `launch_args` are appended after launcher
 * defaults and Chromium is last-wins.
 */
export function resolveGpuFlags(): string[] {
  return [...GL_FALLBACK_FLAGS];
}
