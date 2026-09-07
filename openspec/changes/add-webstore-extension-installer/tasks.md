## 1. Input normalization and download

- [ ] 1.1 Implement `normalizeWebStoreInput` (URL/ID/path disambiguation) in `src/main/extensions/webstore.ts`; table-driven unit tests.
- [ ] 1.2 Implement update-protocol CRX fetch with injectable transport, engine-pinned `prodversion`; mocked happy/offline/404 tests.
- [ ] 1.3 Implement CRX2/CRX3 header verification (magic, version, signed-hash match); rejection tests for corrupt/unsigned blobs.

## 2. Unpack and registration

- [ ] 2.1 Implement versioned unpack to `data/extensions/<id>/<version>/` with manifest localization (`__MSG_*__`); fixture-based tests.
- [ ] 2.2 Wire registration through the existing `importExtension` path (enable/bind/persist unchanged); idempotent re-install test.
- [ ] 2.3 Add `POST /api/v1/extension/install` route with typed error mapping; route tests for all error codes.

## 3. UI and verification

- [ ] 3.1 Extensions page: "Install from Web Store" input (URL/ID) with error display; component smoke via existing UI test approach.
- [ ] 3.2 Update CHANGELOG; full vitest suite + typecheck green; `openspec validate add-webstore-extension-installer --strict`.