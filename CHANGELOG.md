# Changelog

All notable changes are documented here. Releases are published on
[GitHub Releases](https://github.com/wdnameless/antidetect-browser/releases).

## v0.3.1 - NullTrace Portable: no installer, one file

The product ships as a file you run, not an installer. Verified end-to-end: the
built portable binary starts, serves the UI, and writes its data beside itself.

### Installer-free artefacts
- **Windows**: electron-builder `portable` target — a single self-extracting
  `.exe` (`NullTrace-<version>-portable-win-x64.exe`, **102 MB**). The `nsis`
  installer target is removed, so no installer is produced at all.
- **Linux**: `AppImage` — `NullTrace-<version>-portable-linux-x64.AppImage`.
- **macOS**: `dmg` for arm64. Stated plainly: macOS is **not** single-file, and
  because there is no Apple Developer account the build is unsigned, so opening it
  needs the documented quarantine step. This is the same limitation the reference
  product ships with.
- `appId` deliberately unchanged (`com.antidetect.browser`) so existing installs
  can move to the portable artefact.

### The kernel is downloaded, not bundled
- The patched Chromium (425 MB) is no longer baked into the artefact through
  `extraResources`. It is acquired on first use — which is why the Windows file
  dropped from ~600 MB to **102 MB**.
- **Every download is verified before use.** The three platform assets are pinned
  in source with their published SHA256 digests, and a digest mismatch, a corrupted
  payload or a missing release fails closed: nothing usable-looking is left behind
  and a retry needs no manual cleanup. Covered by tests, including a deliberately
  corrupted byte and a wrong expected digest.
- Acquisition comes from the upstream GitHub Releases, so no new hosting account
  was needed. The pinned digests carry a comment recording that they are external
  and must be re-pinned when the kernel version moves.

### Portable data mode
- On a first portable launch the operator chooses whether data lives beside the
  executable or in the system location, and the choice is remembered.
- The portable path is derived from `PORTABLE_EXECUTABLE_DIR` — the directory the
  user actually ran the file from — **not** an absolute path captured at first run.
  That is what makes the folder relocatable: move it to another drive or machine and
  the profiles come with it. Covered by a test that resolves two different
  executable locations to their own data directories.
- An ordinary non-portable launch is never asked the question.
- Storage is untouched (`safeStorage`/DPAPI), so credentials created before this
  change still decrypt.

### CI
The release job is now a three-platform matrix — `windows-latest`,
`ubuntu-latest`, `macos-14` — each building its own artefact, running typecheck and
the unit suite on its own runner so a platform-specific break is caught rather than
shipped. No signing credentials are required or expected.

### Fixed
`package.json` had a `// appId` annotation **inside** the `build` block.
electron-builder rejects unknown properties outright, so every build failed with
`Invalid configuration object`. The note now lives beside `build`, and a test
asserts no comment keys exist inside it.

## v0.3.0 - NullTrace: web application, rebrand, monochrome noir

The product is renamed **NullTrace** and now runs as a **web application**: it opens
in any browser on any operating system with no installer and no code signing.
Taglines: "Zero footprint, infinite scale." / "Leave nothing behind."

### Web platform
- **The interface is served over HTTP by the product's own server.** Express now
  serves the built renderer alongside the existing panel, before the auth middleware
  so the shell and its assets load unauthenticated while every data and action
  endpoint stays behind authentication. An SPA fallback serves the shell for
  client-side routes; API paths are deliberately excluded so a missing endpoint still
  returns JSON rather than HTML.
- **The API base is origin-relative.** A page served from the API's own origin now
  calls that origin instead of the hardcoded `127.0.0.1:50325`, so a non-default port
  works. The Electron path and the explicit override both still work.
- **Login screen** wired to the existing panel auth (`/ui/auth-state`,
  `/ui/setup` one-time, `/ui/login`). The returned token is stored where the existing
  Bearer path already looked for it — no new server-side auth was added.
- Verified in a real browser: the shell renders, the brand block reads NullTrace,
  navigation works, login completes, and the favicon is served.

### Identity
- Renamed on every user-visible surface: window and tray, page title, brand block,
  loading state, both `en` and `ru` localisation, the panel HTML, README, and the
  packaging `productName`/`artifactName`/description.
- Renamed on artefacts that leave the machine: the cookie-export header, the profile
  CSV filename, and the injected bookmark node.
- **Deliberately NOT renamed**, because their values carry cryptographic meaning or
  locate on-disk state — changing any of them would silently re-seed every profile's
  fingerprint, invalidate signed releases, or orphan a user's existing data:
  `HMAC_SECRET`, `SIGNING_DOMAIN_PREFIX`, the database and data-directory names, the
  backup filenames, the `ANTIDETECT_*` environment variables, the instance-lock
  executable name, the preload bridge name, and `build.appId`. Each site documents
  why, and `tests/unit/brandIdentity.test.ts` hardcodes the expected values so a
  future rename cannot quietly complete itself.

### Icon
- One geometry definition, in `scripts/generate-icons.py`, produces the SVG master
  **and** every raster: PNG 1024→16, a multi-size `.ico`, an `.icns`, and the web
  favicon. Generated from the same coordinates, so they cannot drift.
- The mark is a traced black silhouette on a white disc — two ears with a notch, a
  horizontal band with eye cut-outs and a dot, a right-pointing horn, a torn lower-left
  edge, and stamped grain. Monochrome, matching the noir direction.
- Replaces the previous indigo shield favicon, which contradicted the palette.

### Program
OpenSpec `nulltrace-web-rebrand` (manifest, proposal, tasks, three capability specs).
Design-system work — the neutral token layer, the ShardX-shaped grouped shell, and
the page sweep — is specified and scheduled as the next wave.

## v0.2.36 - Competitive parity wave 2: automation, persona, MCP surface

Automation parity with ShardX (OpenSpec `competitive-parity-2026-q3`, wave 2).

- **Global keys usable from a no-code flow.** Earlier claim that global variables
  were missing was **wrong and withdrawn** — they exist end to end (`global_keys`
  table, AES-256-GCM store, `/api/v1/keys`, "Global Keys" tab, `app.keys.get/set`
  with write-back). The real gap was that `compileFlowToScript` never referenced
  them. New flow nodes `key_read` and `key_write` compile onto the existing sandbox
  surface; a missing key fails the run instead of substituting an empty value.
- **Form-filling helper.** `src/main/motion/persona.ts` generates a coherent,
  deterministic person per profile (name, address, region-consistent postcode,
  nationally-shaped phone, name-derived email, Luhn-valid card with a future expiry,
  plausible date of birth) from HMAC-SHA256 domain separation, like the motor seed.
  Filling types through the Motion input path as real key events — never by
  assigning `element.value`. New flow node `fill_form`, API endpoints
  `GET /api/v1/persona` and `POST /api/v1/persona/fill`.
- **MCP tool surface 17 → 47.** Twenty-three new default tools and seven new gated
  ones cover proxies, extensions, flows, task groups, trash, cookies, triggers,
  tags and batch operations — registered through the existing triple
  (manifest + dispatch case + tier set), with the prohibited set, replay defence
  and hash-chained audit log unchanged.
- **FIXED — script engine was completely broken.** `WORKER_SOURCE` had an unclosed
  `http: {` block, which swallowed `app.log` into it and left the worker source
  syntactically invalid. **Every** script and flow run failed with a bare
  `worker error: Unexpected token ';'` and zero log output. Introduced by a wave-2
  edit; caught by an end-to-end probe rather than by the suite, which is why two
  new hygiene guards now parse the worker template and assert the sandbox exposes
  every `app.*` member that compiled nodes call.
- **FIXED — `fill_form` fabricated success.** The node originally fell back to
  logging "Simulated form fill" and returning a `filled` array when the persona
  surface was absent. It now fails loudly, and `app.persona` was added to the
  sandbox so the real path exists.
- **FIXED — persona coherence bugs.** UK postcodes did not match their region and
  UK phone numbers had no separator; US/DE/FR name pools were small enough that
  distinct profile seeds collided on the same person.

## v0.2.35 - Competitive parity wave 1: verified defects closed, data formats added

Gap analysis against ProxyShard/ShardX and Afina.io (2026-09-13) found four shipped
defects — capabilities that were declared or implemented but wired to nothing — and
three operator data formats Afina has and we did not. This release closes them.
OpenSpec program: `competitive-parity-2026-q3` (children `add-font-pinning`,
`add-mobile-sensors`, `add-flow-module-execution`, plus the pre-existing
`add-cookie-sqlite-io`, `add-xlsx-io`, `add-email-manager`, `add-telegram-bot`).

- **Font pinning (defect).** `StealthOptions.fontList` was declared and read by
  nobody, so a page enumerating fonts still saw the host machine's set. Now resolves
  each profile's inventory from its fingerprint family and masks
  `document.fonts.check`, `FontFaceSet.prototype.check`, `measureText`, and the
  sized-element `offsetWidth`/`offsetHeight` probe (`TODO(engine-parity: fonts)`).
  `window.queryLocalFonts` stays present and rejects with a `NotAllowedError`-shaped
  error; `navigator.fonts` is deliberately NOT fabricated (stock Chrome has no such
  object, so adding one would itself be a tell).
- **Mobile motion sensors (defect).** A profile claiming a phone exposed no
  `DeviceMotion`/`DeviceOrientation`/`Sensor` surface at all — one probe separated it
  from a real handset. Now `DeviceMotionEvent`, `DeviceOrientationEvent`, the
  `Sensor` family (`Accelerometer`, `Gyroscope`, `Magnetometer`,
  `LinearAccelerationSensor`, `GravitySensor`), the sensor permission answers, and
  `screen.orientation` all derive from a per-seed profile. Desktop profiles are
  untouched (`TODO(engine-parity: sensors)`).
- **Flow `module` node (defect).** The compiler emitted
  `{ success: true, moduleId, args }` and invoked nothing, so a flow using it
  reported success and did no work. It now compiles to a real
  `app.callModule(id, args)` against the script-engine sandbox, with the call
  counted against the existing HTTP budget, `[FLOW_NODE_ERROR]` on failure, and
  save-time validation rejecting an unknown module id.
- **Telegram bot (defect).** `src/main/telegram/bot.ts` was 296 fully-written lines
  imported by no file. Now constructed at service start, `/start` `/stop` `/status`
  `/list` bound to the real profile and launcher APIs, notifications fired from the
  existing `onProfileStatusChange` hook, polling stopped on shutdown, and a Settings
  section for the token (masked — the raw token is never returned) and chat ids.
- **Cookie SQLite import/export.** Chromium `Cookies` databases in the `v10` format
  (DPAPI-unwrapped key on Windows, AES-256-GCM values), read through the existing
  sql.js module and merged with `INSERT OR REPLACE` on `(name, host_key, path)`.
  Writes to a running profile are refused rather than risking WAL corruption.
- **XLSX import/export** for profiles, via a dependency-free single-sheet OOXML
  reader/writer with byte-stable output and a strict reader.
- **IMAP email manager.** A 4-command client (LOGIN, SELECT, FETCH ENVELOPE, FETCH
  BODY) over TLS with an injectable socket seam, a verification-code extractor, and
  vault-backed account storage with masked secrets.
- **Fixed: import cycle** `migration -> derivation -> catalog -> macosFamilies ->
  migration` left `MAC_MODERN_FONTS` uninitialised depending on import order. `crc32`
  moved to a leaf module (`fingerprints/crc32.ts`); `derivation` re-exports it.
- **Test hygiene guards** (`tests/unit/hygiene.test.ts`): fails the build on a
  declared-but-unconsumed stealth option, an unimported service module, an unmounted
  route module, TypeScript-only syntax inside the browser-injected stealth template,
  and a test sandbox that mis-models `window === globalThis`.

## v0.2.34 - ShardX/Afina parity program: human input, engine surfaces, fleet UX

Parity program vs ProxyShard/ShardX and Afina.io (10 OpenSpec children).

- **Motion CDP domain** (hidden, engine-parity contract stable): Fitts's-law
  pointer glide with per-profile motor seeds, per-key typing with seeded pace
  and optional typo+backspace model. Surfaces: MCP tools
  `browser.human_type` / `browser.human_click`, flow nodes `human_click` /
  `human_type` in the no-code canvas, Node/Python SDK method surface.
- **Engine surfaces (JS-interim, `TODO(engine-parity)` marked)**:
  `navigator.gpu.requestAdapter` resolves the profile family's GPU (host GPU
  never surfaces; WebGPU-less families resolve `undefined` like real Linux
  Chrome); `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable`
  answers the claimed-device matrix, not the host.
- **Web Store extension installer**: install by URL or 32-char ID — CRX fetch
  via the versioned update protocol, signature verification, localized
  manifest unpack, idempotent registration (`POST /api/v1/extension/install`).
- **Bulk fingerprint rotation**: `POST /api/v1/browser-profile/bulk-fingerprint`
  with `rotate` (weighted coherent family resample, seed-hint replayable) and
  `patch` modes; per-item report, coherence-gated persistence, running
  profiles fail closed. Bulk bar action in Profiles UI.
- **Fingerprint catalog v2**: deterministic `catalog-v2.json` bundle (46
  families, sha256-stable), AudioContext/OS-audio coherence rule
  (macOS 48000/44100, Win/Linux 44100/48000 PulseAudio-realistic), coherent
  archetype sampling at profile creation (new profiles derive every hardware
  surface from one weighted family + seed).
- **Screen-capture protection + auto-lock**: `setContentProtection` on app
  windows (WDA_EXCLUDEFROMCAPTURE), idle auto-lock with lock-screen/suspend
  engagement; Settings → Security.
- **Movable data root**: copy-verify-swap relocation with progress/cancel
  (`/api/v1/settings/data-root/move*`), SQLite-image integrity checks,
  absolute-path rewrite; Settings → Data Folder.
- **Task Calendar**: month-grid view over cron triggers and task-group time
  windows (client-side cron projection); sidebar entry.
- **Profile window badge**: per-profile color (3/6-digit hex), badge initials,
  `[XX] ` window title prefix at launch via CDP, color dot in the profiles
  table and picker in the editor.
- **Extra launch args**: per-profile Chromium switches appended LAST
  (last-wins override), save-time denylist (`--fingerprint*`,
  `--remote-debugging*`, `--user-data-dir`, `--proxy-server`,
  `--load-extension`, `--disable-extensions`).
- **Folder bookmarks**: folder-scoped shared bookmarks merged into every member
  profile's Chromium `Bookmarks` at launch (managed node only; user data
  byte-preserved; malformed files quarantined as `.bak`).
- Engine-level hardening change extended with WebGPU/WebAuthn/native-Motion
  patch rows (private-engine chain prerequisite unchanged).

## v0.2.30 - Cloud Sync tab: connect, deploy, sync from the desktop app

- **New "Cloud Sync" tab**: connect the desktop app to your self-hosted
  server instance (URL/IP → sign in or one-time account setup).
- **One-command deploy**: copy a bootstrap PowerShell command that installs
  Node, WireGuard (10.8.0.1 + N peers), builds the app and registers an
  auto-start service on any Windows dedicated machine (`deploy/bootstrap.ps1`).
- **Profile sync**: push local profiles to the server and pull server profiles
  back (bundle export/import over the cloud bridge; running profiles skipped).
- **Devices list**: recent panel logins (time, IP, user-agent) from the server.
- Server-side: login sessions are recorded (`data\panel_sessions.json`) and
  exposed via `GET /ui/sessions`; cloud bridge endpoints under
  `/api/v1/cloud/*` keep remote credentials in the main process.

## v0.2.29 - Server deployment: remote access, web panel + screencast viewer

- **Server mode** (`ANTIDETECT_SERVER_MODE=1`): trusted Host whitelist behind a
  reverse proxy, per-request file log, CORS disabled.
- **CDP tunnel**: `/cdp/:sessionId/*` exposes each profile's loopback DevTools
  endpoint through the single API port (HTTP streaming + raw WS pipe); random
  debug ports stay closed. `browser/start` rewrites `ws.puppeteer` to the
  tunneled URL for remote clients — Puppeteer/Playwright connect unchanged.
- **Web panel** at `/ui`: login with API key, profile list, start/stop/create,
- **Screencast viewer** (`/cdp-view/:id`): streams the running browser into the
  panel via CDP `Page.startScreencast` with full mouse/keyboard control —
  use profiles from any device while Chromium runs on the server.
- **Deploy kit**: Traefik docker-compose bound to the WireGuard interface,
  guides `docs/SERVER_DEPLOY.md` (EN) / `.ru.md` (RU): WireGuard, NSSM
  autostart, RDP session keep-alive, firewall, profile migration.

## v0.2.21 - Premium monochrome redesign & two-pane Settings

- **Monochrome design system**: black/white/gray palette (Vercel/Linear-style) -
  white primary buttons with dark text, gray outlines, monochrome status badges
  and action buttons. All blue/purple accents removed.
- **Two-pane Settings** with sections: General (language), Automation API
  (endpoint + key with show/hide and copy), Data Folder, Updates (app + kernel),
  Diagnostics (logs).
- API key masking (show/hide) and one-click copy.
# Changelog

All notable changes are documented here. Releases are published on
[GitHub Releases](https://github.com/wdnameless/antidetect-browser/releases).

## v0.2.19 — Profile bundles & structured logs (2026-08)

- **Profile bundles**: export/import a full profile (fingerprint seed+config, proxy
  with credentials, cookies, timezone, start_urls, mobile model) as one JSON file.
  UI: "Export Profile" in the row menu, "Import Bundle" in the header. Portable
  between machines (device presets re-linked by stable id).
  API: `GET /browser-profile/export`, `POST /browser-profile/import-bundle`.
- **Structured logs**: `data/logs/app-YYYY-MM-DD.log`, 1s buffered flush, daily
  rotation, 14-day retention. API: `GET /logs/list`, `GET /logs/get`.
  Settings → Diagnostics: "Open Logs Folder" + recent files.

## v0.2.18 — Server-side bulk & pagination

- Bulk endpoints (one request per action, per-item report):
  `POST /browser-profile/bulk-start | bulk-stop | bulk-delete | bulk-group`.
- Server-side `search` (name/id/proxy host), `platform` and `status` filters on
  `/browser/list` and the AdsPower v2 alias.
- UI pagination: 50/100/200 per page; bulk bar uses the new endpoints.

## v0.2.17 — Tests & CI

- Vitest suite (34 tests: presets, rate limit, auth, DB persistence, pagination,
  bundle roundtrip) in an isolated sandbox.
- GitHub Actions: typecheck + tests on push/PR; installer build+publish on `v*` tags.

## v0.2.16 — Data protection hardening

- **Atomic DB writes** (tmp + rename) — a crash can no longer corrupt the database.
- Debounced persist (100 ms) instead of a full-DB export on every statement.
- **Daily rotating backups** (last 5) in `data/backups`.
- **Crash recovery**: stale "running" profiles marked "closed" on startup.
- **Tree-kill** (`taskkill /T /F`) + process watchdog (kernel exit syncs DB status).
- **Graceful shutdown**: SIGINT/SIGTERM + Electron `before-quit` with DB flush.
- **Single-instance lock** (`service.lock`).
- **API hardening**: timing-safe key comparison, Host header validation
  (DNS-rebinding protection).

## v0.2.15 — Bulk actions bar & quick filters

- Floating bulk actions bar (start/stop/move to group/delete, select all).
- Platform and status filters in the profiles header; click-to-copy seed.

## v0.2.14 — UX polish

- Proxy type guide + friendly empty states; favicon; fixed device column duplication.

## v0.2.13 — Beginner-friendly UX

- Empty states with guidance (Profiles, Extensions); simplified fingerprint tab;
  clearer Settings copy.

## v0.2.12 — Groups page, rate-limit fix, duplicate profiles

- Dedicated Groups page (create/rename/delete with warnings, jump to profiles).
- Rate limits raised (lists 20/s, start/stop 10/s, /status 50/s) + transparent
  auto-retry with backoff on 429 in the renderer client.
- Duplicate profiles (UI + `POST /browser-profile/duplicate`).

## v0.2.11 — Manual seed & fixed phone model

- Manual fingerprint seed input; explicit phone model selection from the 30-model
  Android pool (long-lived accounts keep one "phone").
  API: `mobile_model_id` on create/update, `GET /device/mobile-presets`.

## v0.2.10 — Android phone pool

- 30 realistic Android presets (Pixel/Galaxy/Xiaomi/OnePlus/Nothing) with real
  GPU/WebGL renderers; deterministic per-seed phone selection.

## v0.2.6 – v0.2.9

- Bundled chromedriver (Selenium out of the box), start_urls, rate limiting with
  SDK auto-retry example, user-configurable data directory.
