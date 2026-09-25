# Interfaces — release 0.6.44

Public boundaries this change touches, with signatures and the single owner of each.

## Main process (`src/main`)

### `src/main/profiles/profileManager.ts` — owner of profile persistence

| Symbol | Signature | Change |
|---|---|---|
| `ProfileDetails` | `interface` | **Added** `mobile_model_id: string \| null`. Must be present in the payload because the Edit modal reads it back and sends it on save; omitting it was silently nulling a pinned model. |
| `getProfileDetails` | `(id: string) => ProfileDetails \| null` | Returns `mobile_model_id`. |
| `parseFingerprintConfig` | `(raw: string \| null) => Record<string, unknown>` | **New, module-private.** One parse for the 6 sites that read `fingerprints.config_json`; a malformed blob yields `{}` instead of throwing on the launch path. |
| `buildFingerprintConfig` | `(seed: number, base?: Record<string, unknown>) => Record<string, unknown>` | **New, module-private.** The single coherent config builder (family + locale + hardware from ONE seed). Replaces 3 drifted copies in `createProfile`, the `rotate` branch of `rotateFingerprints`, and `randomizeProfileFingerprint`. |
| `randomizeProfileFingerprint` | `(id: string) => number \| null` | **Behaviour change:** writes `seed` AND the derived `config_json`. Previously seed-only, which produced a preflight-failing hybrid. |

Internal-only: `ProfileDetails` is returned by `getProfileDetails`, which is reached through
`GET /api/v1/browser-profile/detail`.

### `src/main/api/routes/browser.ts` — owner of browser-profile routes

| Route | Response | Notes |
|---|---|---|
| `GET /api/v1/browser-profile/languages` | `{ code: 0, data: { list: string[] } }` | **New.** The selectable browser languages, derived from `WINDOWS_FINGERPRINT_CATALOG` + `EXTENDED_FINGERPRINT_CATALOG` `localePool`s. Single source of truth: the renderer no longer hard-codes a list. Mounted with `browserRoutes`, behind the existing Bearer gate and the default 20 req/s limit. |

## Renderer (`src/renderer/src`)

| Symbol | Where | Change |
|---|---|---|
| `FALLBACK_BROWSER_LANGUAGES` | `pages/Profiles.tsx` | **New export.** Core locale set used until `api.browserLanguages()` answers. Deliberately the catalog's core set, not the old seven — a failed request must not make a stored language unrepresentable. |
| `COMMON_TIMEZONES` | `pages/Profiles.tsx` | **New export.** Convenience list for the Timezone select; always rendered alongside the profile's own zone. |
| `browserLanguages()` | `api.ts` | **New.** `request<{ list: string[] }>('/api/v1/browser-profile/languages')`. |
| `ProfileDetails.mobile_model_id` | `api.ts` | **Added** `mobile_model_id?: string \| null`, removing the `as any` read that hid the server-side omission. |

### Behaviour contracts asserted by tests

- **A `<select>` must be able to represent any value the API can store for it.** Both the language
  and timezone selects render the profile's own value in addition to their curated list. A control
  that cannot represent a stored value renders a different one and then writes it back.
- **`bindExtensions(profileId, ids)` REPLACES the profile's whole set.** Any caller binding one
  extension must read the current set and merge. Documented at the call site.
- **`updateGroup(id, name?, bookmarks?)` writes a column only when the argument is not `undefined`.**
  A caller with no bookmark editor must omit the argument rather than send `[]`.
- **A version is carried by four files** (`package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, and the `nulltrace-tauri-shell` entry in `Cargo.lock`) and the tag must
  match. `updater.rs` compiles the Cargo one as the installed version for its anti-rollback check.

## Build / release boundaries (not modified)

- `.github/workflows/ci.yml` — `release` job is gated on `refs/tags/v*`; it runs `test`, `sdk` and
  `release-macos` first. Publishing is done by CI, not locally.
- `src-tauri/src/updater.rs` — **read only.** Its `verify_artifact` uses
  `env!("CARGO_PKG_VERSION")`; the change was to make the version it compiles correct, not to touch
  the guard.
- `docs/RELEASE.md` — the authoritative release procedure. Followed rather than reinvented.
