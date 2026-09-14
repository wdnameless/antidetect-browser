# Tasks — nulltrace-web-rebrand

Order: identity boundary → brand → icon → web platform → design system → pages → Tauri.
Every wave keeps the suite green (108 files / 827 tests) and typecheck clean.

## 1. Identity boundary (do this FIRST — it constrains everything else)

- [ ] 1.1 Produce the rename map: for every `Antidetect`/`antidetect` occurrence, classify as RENAME (user-visible identity), KEEP (data/crypto compatibility), or INTERNAL (safe but wiring-sensitive). ~160 hits across ~52 files — the map is the deliverable, not a guess.
- [ ] 1.2 Mark the KEEP set in code with a one-line reason at each site so a future rename attempt does not silently re-seed fingerprints or orphan data. The KEEP set is exactly: `HMAC_SECRET` (`fingerprints/derivation.ts:8`), `SIGNING_DOMAIN_PREFIX` (`security/signing.ts:55`), `DATA_DIR`/`DB_PATH` names, backup filenames, `ANTIDETECT_*` env var names, the instance-lock executable-name match, and the `.antidetect` directory.
- [ ] 1.3 Regression test: the KEEP values are byte-identical to their pre-rename values. A rename that changes `HMAC_SECRET` must fail the suite, because it would silently change every profile's fingerprint.

## 2. Brand

- [ ] 2.1 User-visible rename to NullTrace: window title and tray tooltip (`electron/main.ts:181,215`), `<title>` (`src/renderer/index.html:6`), brand block + loading text (`App.tsx:135,153-158`), i18n strings in BOTH `en` and `ru` (`i18n.tsx:18,259,319`), panel HTML (`uiPanel.ts:10,48,66`), README title, package `productName`/`description`.
- [ ] 2.2 Taglines: "Zero footprint, infinite scale." as the primary, "Leave nothing behind." as the supporting line. Define them ONCE (a small brand module) and consume from there — do not scatter the literals.
- [ ] 2.3 Export-surface identity: cookie-export header (`routes/cookies.ts:65`), CSV filename (`routes/profiles.ts:40`), bookmark node name (`folders/bookmarks.ts:44`), kernel-update UA string. These leave the machine, so they are user-visible.
- [ ] 2.4 Packaging metadata: `appId`, `artifactName`, `publish.repo`, package names in `packages/*` and `mcp/`, `pyproject` author. Report anything that would break an existing signed release or update path before changing it.
- [ ] 2.5 i18n completeness check: a test asserting no `en` key still contains the old name while its `ru` counterpart does not, in either direction.

## 3. Icon

- [ ] 3.1 Trace the reference mark into ONE SVG master: black silhouette on a white disc — two triangular ears, a horizontal band with two white cut-outs, a right-pointing horn, a torn lower-left edge, grainy stamp texture. Store it as the single source of truth.
- [ ] 3.2 Generate every format from that master: PNG 1024/512/256/128/64/32/16, multi-size `.ico`, `.icns`, and a favicon that replaces the current indigo shield data-URI (`index.html:7`) — a colour that contradicts the noir direction.
- [ ] 3.3 A test or script asserting every generated artefact derives from the master and is non-empty, so the set cannot drift apart.

## 4. Web platform

- [ ] 4.1 Serve `dist/renderer` from Express: `express.static` mounted alongside the existing `/ui` block and BEFORE `authMiddleware` (`server.ts:99`) so the shell and assets load unauthenticated while every API call behind it stays authenticated. Add the SPA fallback to `index.html` and favicon serving, all inside the existing `hostAllowed` guard.
- [ ] 4.2 `getApiBase()` (`api.ts:144-151`) becomes origin-relative when the page is served from the API's own origin, keeping the `localStorage` override and the Electron path working. A same-origin page must call its own origin, not a hardcoded `127.0.0.1:50325`.
- [ ] 4.3 Login screen wired to the EXISTING panel auth: `GET /ui/auth-state` → `POST /ui/setup` on first run, else `POST /ui/login`; store the returned token as `localStorage.apiKey` so the existing Bearer path works unchanged. No new server-side auth.
- [ ] 4.4 Verify in a real browser: the UI loads, login completes, a profile list renders, an action round-trips, and a WebSocket surface (recorder/motion/CDP) connects same-origin.
- [ ] 4.5 Confirm the Electron build still works after the serving changes (dev `loadURL` and prod `loadFile` both intact).

## 5. Design system

- [ ] 5.1 Redefine the `:root` token layer (`styles.css:1-29`) as a neutral ramp: no hue anywhere. `--accent` becomes white-on-black inversion rather than a colour, and the semantic states (ok/warn/danger) are re-expressed with the grey ramp plus shape/weight/icon, since colour is unavailable.
- [ ] 5.2 Rebuild the shell to ShardX's shape: grouped sidebar (WORKSPACE / LIBRARY / SYSTEM) with small uppercase section labels, a breadcrumb row, a page header carrying title + one-line description + right-aligned actions, and a low-density content card. Replace the current flat 14-item `NAV` array (`App.tsx:45-59`).
- [ ] 5.3 Add the missing primitives as class-based components: page header, toolbar, table, empty state, status indicator, toggle. Several are re-implemented inline in every page today.
- [ ] 5.4 Remove the second token dialect: `var(--bg-secondary, #1e1e24)`-style fallbacks referencing variables that do not exist in `:root` (`Email.tsx`, `SyncSettings.tsx`, others) — these silently collapse at restyle time.

## 6. Pages

- [ ] 6.1 Sweep order, worst first: `FlowCanvas.tsx` (also has raw hex inside inline SVG markers), `Profiles.tsx`, `Email.tsx`, `Calendar.tsx`, `Diagnostics.tsx`, `FleetPanel.tsx` (`STATUS_COLORS` hex map), then the remaining pages.
- [ ] 6.2 Do not touch user-data colours (profile/tag colour pickers) — those are data the operator chose, not chrome.
- [ ] 6.3 After the sweep, a test asserting no hue-bearing literal remains in chrome code, so the noir direction cannot silently regress.

## 7. Verification

- [ ] 7.1 Full suite green, typecheck clean, and a browser walkthrough of the main flows on the served UI.
- [ ] 7.2 CHANGELOG entry; update `README.md` for the web path; record the loopback/LAN access rules.
- [ ] 7.3 Confirm the deferred list is intact: no `HMAC_SECRET`/signing-domain/on-disk-name change, no server rewrite, no public-internet hosting.

## 8. Tauri shell (later wave, R38)

- [ ] 8.1 Thin Tauri shell pointing at the same served UI, with the Node backend as a sidecar. Blocked until the web path is verified working, and it does not remove macOS code signing — record that plainly.
