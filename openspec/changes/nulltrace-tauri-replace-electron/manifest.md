# Requirements manifest — nulltrace-tauri-replace-electron

Every row traces to the user's own words (2026-09-15). Silence never cancels a row.
`i`-suffix = implicit requirement surfaced by the interview.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R01 | Electron is abandoned entirely; Tauri becomes the desktop shell | «давай откажемся от электрона полностью и перейдем на tauri» | in-spec |
| R02 | The audit that established what Electron actually does (`electron/main.ts`, `preload.ts`, backend decoupling) is the basis of the migration | «Посмотри, что у нас реализовано на электроне…» | in-spec |
| R03 | Windows portable artefact stays a **single file** | user chose «Кастомный NSIS portable (single-file)» | in-spec |
| R04 | The Node.js runtime is bundled — the operator must not install Node | user chose «Бандлить node.exe как sidecar» | in-spec |
| R05 | Ordering: Tauri becomes the primary build first; Electron is removed one release later | user chose «Сначала Tauri основной, Electron удалить через релиз» | in-spec |
| R06 | Screen-protection parity implemented in Rust: capture exclusion + idle auto-lock + lock/suspend locking | user chose «Полный паритет в Rust» | in-spec |
| R07 | Updates via `tauri-plugin-updater` **and** the existing signed-manifest + keyring verification retained as a second barrier | user chose «Tauri updater + своя проверка манифеста» | in-spec |
| R08 | All three platforms targeted: Windows, macOS (arm64), Linux | user chose «Все три платформы» | in-spec |
| R09 | The portable single-file artefact self-updates (downloads and replaces its own `.exe`) | user chose «Portable с самообновлением» | in-spec |
| R10 | Windows is built and verified in CI; macOS/Linux ship configuration only, **no artefacts published** until they can be built | user chose «Windows собирается; mac/Linux — конфиг, без публикации» | in-spec |
| R11 | Full screen-protection parity on Windows; capture protection only on macOS/Linux, idle+lock recorded as an explicit gap | user chose «Полный паритет на Windows, capture — везде» | in-spec |
| R12 | Secrets keep working: DPAPI provided by a Rust command so existing `enc:` values survive | user chose «DPAPI-команда в Rust» | in-spec |
| R13i | The renderer must not fork: the `window.antidetect` bridge keeps its name and shape so `App.tsx`/`Settings.tsx`/`api.ts` keep working unmodified | derived from R01 + existing `hasNativeWindow` guard | in-spec |
| R14i | An existing installation is not orphaned: `DATA_DIR` (`%APPDATA%\antidetect-browser`) and the DB it holds are preserved | derived from R01 + `docs/DECISIONS.md` ADR-005 | in-spec |
| R15i | The served web interface (`npm run service`) is untouched — the shell is a window over it, not a second implementation | derived from R01 + `openspec/changes/nulltrace-tauri-shell/proposal.md` | in-spec |
| R16i | macOS ad-hoc signing (`signingIdentity: "-"`) is retained — Apple Silicon refuses unsigned arm64 | derived from R08 + `tests/unit/macosPackaging.test.ts` | in-spec |
| R17i | The kernel-is-not-bundled policy stays: fingerprint-chromium (425 MB) is fetched at first run, never baked into the artefact | derived from R03 + `scripts/ensure-kernel.mjs` | in-spec |
| R18i | The sidecar readiness signal must match what the backend actually prints | derived from R04 + measured defect (`sidecar.rs` waits for `"Server running at"`, backend prints `[antidetect] ready.`) | in-spec |

### Requirements added after Wave 0 (owner follow-ups)

These came from the owner reviewing the running build, not from the original migration brief.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R19 | A light theme exists and can be switched | «Добавь светлую тему» | done |
| R20 | The theme choice persists and does not flash on start | derived from R19 | done |
| R21 | MCP and the Local API are verified working | «проверь что мсп и апи корректно работает» | done |
| R22 | The browser kernel can be installed from the app | «пофикси все что что мы не доделали» + measured gap: a shipped build had no kernel and could not launch a profile | done |
| R23 | Automatic updates can actually be published | measured gap: the endpoint pointed at a `latest.json` nothing produced | done |
| R24 | The 12 destructive MCP tools are reachable when the operator opts in | measured gap: `defaultScope` was hardcoded and the env was read only on the stdio path | done |
| R25 | UI colours come from tokens, so both themes stay legible | derived from R19: hardcoded `#fafafa`/`#a1a1aa`/`#fff` broke on light | done |
| R26 | The sidebar shows no overflow and its footer follows the reference | «сайдбар все еще кривой и я хочу чтобы нижняя часть с мсп была такой же как в референсе» | done |

## Measured facts this plan is built on (evidence, not assumption)

| Fact | How it was established |
|---|---|
| The backend runs with **no Electron at all** | `node dist/src/main/index.js` → `[antidetect] Local API listening on http://127.0.0.1:50399` |
| The **current** Tauri sidecar is broken | It spawns `dist/electron/main.js`, which dies on `electron-updater` under plain node; and it waits for a readiness line the backend never prints |
| `frontendDist` may be an HTTP URL in Tauri v2 | `FrontendDist::Url(Url)` variant in `tauri-utils/src/config.rs` |
| Rust toolchain + WebView2 present on this host | `cargo 1.95.0`; `cargo build` exit 0; WebView2 `152.0.4191.66` |
| Baseline suite | 124 files, **994 passed / 1 skipped** |
| Electron globals leaking into the backend | exactly 3 sites: `process.resourcesPath` (`config.ts` ×2), `require('electron')` (`screenProtection.ts` ×3), `safeStorage` (`util/secretStore.ts`) |

## Known limits recorded up front

- **`tauri-plugin-updater` JS `download()` hands no bytes to JavaScript** — it keeps them in a Rust
  `Resource`. Independent verification of the artefact therefore **cannot be done in JS**; it must run in
  Rust (or in the sidecar over bytes Rust hands it) *before* `Update::install(&bytes)`. The existing
  `verifyUpdateBeforeApply` takes a **file path**, which the plugin never exposes. That signature has to change.
- **No `resources/release-keyring.json` exists in the repo.** `resolveKeyRing` therefore returns an *empty*
  keyring, which makes `verifyUpdateBeforeApply` refuse every update. This is a pre-existing defect that
  becomes load-bearing once the verification path is rewritten (R07) — it is recorded, not silently inherited.
- macOS and Linux artefacts cannot be built or run on this Windows host, so R08's macOS/Linux halves are
  **configuration, not proof** — matching R10.
- `GetLastInputInfo` / `WM_POWERBROADCAST` / `WTSRegisterSessionNotification` have no macOS/Linux
  equivalents in this wave (R11).
