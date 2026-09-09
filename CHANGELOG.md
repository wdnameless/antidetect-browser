# Changelog

All notable changes are documented here. Releases are published on
[GitHub Releases](https://github.com/wdnameless/antidetect-browser/releases).

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
