# Design: Web Store Extension Installer

## Context and Scope

Headless CRX acquisition for the existing extensionManager. No browser UI is involved; the fetch happens from the main process.

## Key Decisions

1. **ID normalization first**: accept `https://chromewebstore.google.com/detail/<slug>/<id>`, `https://chrome.google.com/webstore/detail/<id>`, or a bare 32-char `a-p` ID. One pure function `normalizeWebStoreInput(input): { id } | { path }` — local paths bypass to the existing importer.
2. **Update-protocol download**: `https://clients2.google.com/service/update2/crx?prodversion=<engine>&acceptformat=crx2,crx3&x=id%3D<id>%26uc` — `prodversion` pinned to the running engine's major version so stores serve compatible builds. Response is a CRX3 (or CRX2) blob.
3. **Signature verification**: parse the CRX3 header (magic `Cr24`, version `3`, protobuf header) and require the signed hash tree to match the zip payload; CRX2 (DER header) also accepted. Invalid magic/header → `BAD_SIGNATURE` error, nothing is written to disk.
4. **Unpack + register**: zip extracted to `data/extensions/<id>/<version>/` (version from `manifest.json`, fallback `0.0.0`); existing `importExtension` consumes the unpacked folder so enable/bind/persist flows stay unchanged.
5. **Localized metadata**: `__MSG_*__` placeholders resolved from `_locales/<default_locale>/messages.json` when present — name/description in lists match what the store shows.
6. **Idempotent installs**: re-install of same id+version is a no-op returning the existing extension; different version installs side-by-side and rebinds the profile to the newer one.

## Testing Strategy

- `tests/unit/extensions/webstore.test.ts`: normalization table tests (URL forms, bare ID, local path, garbage → error), CRX3/CRX2 header parse with fixture headers, signature-mismatch rejection, manifest localization resolution.
- Mocked HTTP transport (injectable fetch seam, following the repo's DI pattern): happy path, 404, offline, truncated body.
- Unpack fixture: a minimal signed-format CRX container with a tiny manifest zip; assert directory layout and manager registration state.
- API route test: `POST /api/v1/extension/install` happy path + error mapping table (assert 400/404/502 distinctions).