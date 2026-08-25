# Changelog

All notable changes are documented here. Releases are published on
[GitHub Releases](https://github.com/wdnameless/antidetect-browser/releases).

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
