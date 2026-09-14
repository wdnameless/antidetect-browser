## Why

Three user directives in one program: make the product reachable as a **web application** instead of only an installed desktop bundle, **rebrand** it to **NullTrace**, and **redesign** the interface into a monochrome noir system modelled on ShardX's information architecture.

Reconnaissance found the terrain is far kinder than expected:

- **The renderer is already HTTP-only.** `src/renderer/**` contains zero `ipcRenderer` / `window.electron`. Every call goes through `src/renderer/src/api.ts` over `fetch` + WebSocket. Nothing about the UI depends on being inside Electron.
- **The Vite build is already HTTP-servable unchanged.** `base: './'` (`src/renderer/vite.config.ts:7`) means asset URLs are relative, so the same `dist/renderer` output works both from `loadFile` and from an HTTP root.
- **Authentication already exists server-side.** `panelAuth.ts` provides `GET /ui/auth-state`, `POST /ui/setup` (one-time), `POST /ui/login` returning `{token}`, and the renderer's `api.ts` already supports `localStorage.apiKey` + `Authorization: Bearer`. What is missing is only a login screen and the static mount.
- **A token layer already exists** in `src/renderer/src/styles.css:1-29` (~30 custom properties, already dark and already neutral). The redesign is a matter of redefining that layer, rebuilding the shell, and sweeping the hardcoded literals — not of introducing a styling system.

The real costs are known and bounded: ~160 identity strings across ~52 files, ~200+ hardcoded colour literals across pages, and one data-compatibility trap (`HMAC_SECRET` re-seeds every fingerprint).

## What Changes

**Web platform.** Serve the built renderer from the existing Express server so the product opens in any browser on any OS with no install and no code signing. Add a SPA fallback, a login screen wired to the existing panel auth, and make `getApiBase()` origin-relative so a same-origin page calls its own server instead of a hardcoded `127.0.0.1:50325`. Keep the Electron build working throughout.

**Identity.** Rename the product to NullTrace with the tagline pair "Zero footprint, infinite scale." / "Leave nothing behind." across user-visible surfaces: window title, page title, brand block, loading text, tray tooltip, i18n strings, exported artefact headers, packaging metadata. Internal identifiers that carry data compatibility or cryptographic meaning are explicitly **not** renamed, and the reason is documented at each site.

**Icon.** One SVG master traced from the reference mark, generated into every format the product needs (PNG set, `.ico`, `.icns`, favicon), replacing the current indigo shield data-URI favicon which contradicts the noir direction.

**Design system.** Extend the existing token layer into a proper neutral ramp with hue-free semantic states, rebuild the sidebar into ShardX's grouped shape (WORKSPACE / LIBRARY / SYSTEM), add the breadcrumb + title + description header pattern, and add the missing primitives (table, empty state, page header, toolbar). Then sweep pages onto tokens.

## Capabilities

### New Capabilities
- `nulltrace-platform`: browser-served UI, origin-relative API access, login.
- `nulltrace-identity`: product name, taglines, icon, and the data-compatibility boundary.
- `nulltrace-design-system`: neutral token layer, shell, primitives.

### Modified Capabilities
- `parity-baseline`: the release matrix gains a browser target that needs no installer.

## Impact

- `src/main/api/server.ts` (static mount + SPA fallback), `src/main/api/panelAuth.ts` (unchanged server-side, consumed by a new screen), `src/renderer/src/api.ts` (`getApiBase`), new login surface in the renderer.
- Identity: `electron/main.ts`, `src/renderer/index.html`, `src/renderer/src/App.tsx`, `src/renderer/src/i18n.tsx`, `package.json`, `README.md`, `src/main/api/uiPanel.ts`, exported-artefact headers.
- Design: `src/renderer/src/styles.css`, `src/renderer/src/App.tsx`, new primitives under `src/renderer/src/components/`, then pages.
- Assets: `resources/icon.png`, `resources/tray-icon.png`, new `.icns`, regenerated `.ico`, new favicon.
- Tests: 108 files / 827 tests stay green; new coverage for the serving path, origin resolution, icon generation and token completeness.

### Goals

- Open the product in a browser on macOS, Windows, Linux, iOS or Android with no installer and no signing.
- Rename without touching a single byte on disk that a user's profiles depend on.
- One visual system, one icon master, one place for brand strings.

### Non-Goals

- No server-side rewrite. Express, sql.js and the existing API surface stay.
- No multi-tenant hosting, no public internet exposure, no user accounts beyond the existing panel password.
- No change to `HMAC_SECRET`, `SIGNING_DOMAIN_PREFIX`, data/DB filenames, `ANTIDETECT_*` env vars, or the instance-lock executable name.
- Tauri is a later wave, not this one.

### Risks and commitments

- **Data compatibility is the top risk.** `HMAC_SECRET` derives every fingerprint sub-seed; changing it would silently give every existing profile a different identity. It does not change. Same for the signing domain (would invalidate release verification) and the on-disk names (would orphan data).
- **Loopback-only by default.** `API_HOST` defaults to `127.0.0.1` and `hostAllowed` rejects non-loopback Host headers. Browser access from another device therefore requires `API_HOST` + `SERVER_MODE` + `TRUSTED_HOSTS`. Local browser access needs none of that, and is the default deliverable.
- **The panel token is the API key** with no cookie and no expiry. A login screen is accepted as the honest minimum; a real session layer is out of scope this wave and is recorded as a follow-up.
- **~200+ inline colour literals** are the design system's blast radius. Tokens fix the class-based surfaces immediately; pages are swept in a defined order, worst-first.
- **`ui.tsx` brand strings are duplicated in `en` and `ru`.** Both must change together or the UI becomes bilingual-inconsistent.
