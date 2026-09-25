# Interfaces — release 0.6.45

## Changed public surface

### `src/main/profiles/profileManager.ts`

| Symbol | Signature | Change |
|---|---|---|
| `parseStartUrlsColumn` | `(raw: string \| null \| undefined) => string[]` | **New, exported.** Same contract as `parseBlockedPortsColumn`: a legacy or corrupt column degrades to `[]` instead of throwing, because it is read while copying a profile. Non-string entries are dropped rather than cast, since the result is fed back into `createProfile`. |
| `operatorConfigColumns` | `(row: ProfileRow) => { launch_args; color; notes; do_not_track; blocked_ports; webrtc_policy; headless; start_urls }` | **New, module-private.** ONE mapper for the operator-set columns. Both the detail payload and the export bundle previously built this object separately and both dropped the same seven fields; a single mapper is what makes that impossible to repeat. `headless` is normalised `1/0/NULL → boolean` here. |
| `duplicateProfile` | `(userId, newName?) => string \| null` | **Behaviour:** carries `start_urls`, `launch_args`, `color`, `do_not_track`, `blocked_ports`, `webrtc_policy`, `headless`. `notes` deliberately not copied. |
| `ProfileBundle['profile']` | interface | **Added (all optional):** `launch_args?`, `color?`, `notes?`, `do_not_track?`, `blocked_ports?`, `webrtc_policy?`, `headless?`. Optional because a bundle outlives the build that wrote it — required fields would make every previously exported bundle unreadable. |
| `exportProfileBundle` | `(id) => ProfileBundle \| null` | Fills the seven fields via the shared mapper. |
| `importProfileBundle` | `(bundle) => string` | Applies them; an absent value means "not set", not "explicitly cleared". |

### `src/renderer/src/preflight.ts`

| Symbol | Change |
|---|---|
| `COUNTRY_TO_LANG` | Values are now **full locales** (`de-DE`) and every one is a locale the fingerprint catalog derives. The previous bare subtags (`de`) were unrepresentable in the Browser-language select, so the Fix wrote a value the UI then overwrote with "Auto". |
| `DEFAULT_FIX_LANG` | **New, module-private.** `en-US` — a catalog locale, for the same reason. |

No public API route changed. `GET /api/v1/browser-profile/languages` (added in 0.6.44) is the source
the new guard checks the Fix table against.

### `src/main/api/server.ts`

| Symbol | Change |
|---|---|
| `GET /status` | `rateLimitMiddleware` attached at the route. The route stays early and unauthenticated; the declared 50 req/s limit becomes real. |

## Unchanged boundaries (deliberately not touched)

- `src-tauri/src/updater.rs` — **read only.** Its `verify_artifact` compiles `CARGO_PKG_VERSION` as the
  installed version for the anti-rollback check; nothing here modifies the guard. The 0.6.44 fix was
  to make the version it compiles correct.
- `src-tauri/src/main.rs` — `tauri_plugin_updater` is wired as before. The plugin's pubkey is
  **compile-time** (`verify_signature(&buffer, &self.signature, &self.config.pubkey)` in its
  `download()`), which is precisely why a key rotation cannot be fixed from the app side and why the
  consequence is recorded rather than papered over.
- `.github/workflows/ci.yml` — unchanged. The release job remains gated on `refs/tags/v*` and builds
  from the tag, so no local build is part of the release path.

## New recorded artifact

`resources/release-key-identity.json` — which minisign key this project ships (`active.keyId`), when
it took effect, and the retired key with the reason it was retired. Guarded by
`tests/unit/updaterKeyIdentity.test.ts`. It exists because a silent key rotation breaks no build,
fails no test, and looks correct to the user — it is only visible by verifying a real installed
artifact against a real shipped key.
