## Context

Current profile creation logic picks individual fingerprint attributes independently or uses fixed string constants in `profileManager.ts` and `stealthInjection.ts`. Real devices exhibit tight correlations: low-end integrated GPUs correlate with 4-8 GB RAM and 4-core CPUs; high-end discrete GPUs correlate with 16-64 GB RAM, 8-16 cores, and specific Direct3D feature levels.

Public dated observations (2026-08) from Steam Hardware Survey, StatCounter Global Stats, and Windows Device Portal telemetry confirm the distribution of Windows configurations in the wild.

## Decisions

### 1. Exactly 30 Curated Windows Families
The catalog defines 30 distinct profile archetypes spanning common laptop, desktop, enterprise workstation, and budget PC configurations:
- 12 mainstream Intel Core (i5/i7) + Iris Xe / Intel UHD laptops.
- 10 AMD Ryzen (5/7) + Radeon Graphics / RTX 3060/4060 laptops and desktops.
- 6 High-end desktop gaming/workstations (RTX 4070/4080/4090, 8-16 cores, 32-64GB RAM).
- 2 Entry-level budget systems (Celeron/Athlon/i3, 4GB RAM, 4 cores).
Every family contains normalized frequency weights where `sum(weights) == 1.000000`.

### 2. Positive Signed int32 Seed Space & Domain Separation
- Seed range: `1..2147483647` (positive signed 32-bit integer).
- Sub-seeds are derived via HMAC-SHA256:
  - `seed_canvas = HMAC(seed, "canvas")`
  - `seed_audio = HMAC(seed, "audio")`
  - `seed_webgl = HMAC(seed, "webgl")`
  - `seed_fonts = HMAC(seed, "fonts")`
  - `seed_rects = HMAC(seed, "rects")`

### 3. Strict Cross-Surface Coherence Invariants
- GPU vs RAM vs CPU: A family with Intel UHD 620 CANNOT specify 64 GB RAM or 16 CPU cores.
- Screen vs Pixel Ratio: Standard 1920x1080 desktop screens MUST have `devicePixelRatio: 1`, while 2560x1440 or high-DPI laptops have `1.25` or `1.5`.
- Font list vs Windows version: Windows 11 families MUST include Segoe UI Variable fonts; Windows 10 families use standard Segoe UI.
- User-Agent & Client Hints: Architecture, platform version, and brand strings MUST match exact Chromium releases.

### 4. Legacy Seed Replay & Migration
- If a legacy profile has `seed <= 0` or undefined, migration MUST deterministically derive a valid positive seed:
  `seed = (crc32(profile.id) & 0x7FFFFFFF) || 1`.
- Silent randomization on startup is strictly prohibited to guarantee replay consistency.

## Risks / Trade-offs

- [Distribution shift over time] -> Catalog versioning (`CATALOG_VERSION = "2026.08"`) allows orderly updates without mutating existing profile seeds.
- [Anti-fraud correlation detection] -> Synthetic noise is layered on top of coherent archetypes rather than conflicting base properties.

## Migration Plan

- Catalog introduced in `src/main/fingerprints/catalog.ts`.
- Profile creation invokes `getCatalogFamilyBySeed(seed)`.
- Existing profiles run migration step on first load.
