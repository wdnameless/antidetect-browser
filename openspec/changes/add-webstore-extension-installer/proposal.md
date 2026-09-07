## Why

ShardX and Afina install extensions by Web Store URL or ID — the launcher downloads the `.crx` itself. Our `extensionManager` only imports local folders/zips (`POST /api/v1/extension/import` takes a path). Users onboarding real workflows (wallets, captcha solvers) currently must download CRX files manually.

## What Changes

- New `src/main/extensions/webstore.ts`: input normalization (Web Store URL → 32-char ID, bare ID, local path), CRX3 download via the versioned update-protocol endpoint, CRX signature-header verification, unpack to `data/extensions/<id>/<version>/`, registration in the existing extensionManager with manifest-derived metadata (name/version/description/icon incl. localized `__MSG_*__` resolution).
- API: `POST /api/v1/extension/install` accepting `{ url | id | path }`; extends the existing extensions route file.
- UI: Extensions page gains an "Install from Web Store" input (URL/ID).

## Capabilities

### New Capabilities
- `webstore-extension-installer`: ID/URL normalization, CRX3 fetch over the update protocol, signature verification, versioned unpack, manager registration.

### Modified Capabilities
- `interim-stealth-hardening`: none (installer never executes extension code during import).

## Impact

- `src/main/extensions/webstore.ts` (new), `src/main/extensions/extensionManager.ts` (registration hook), `src/main/api/routes/extensions.ts` (one route), `src/renderer/src/pages/Extensions.tsx` (input), tests in `tests/unit/extensions/`.
- Network egress only to `clients2.google.com` / `update.googleapis.com` update endpoints; no browsing, no accounts.
- Failures are explicit: offline, 404, bad signature, corrupt archive — each a distinct error code surfaced to API and UI.