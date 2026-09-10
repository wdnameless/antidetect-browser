## 1. Read and merge

- [ ] 1.1 Read path: sql.js sandbox reader for Chromium Cookies schema + row normalisation; fixture tests.
- [ ] 1.2 v10 AES-GCM decrypt/encrypt + DPAPI seam; roundtrip unit test with a known key.
- [ ] 1.3 Import route with INSERT OR REPLACE merge + running-profile refusal; route tests.

## 2. Export and verification

- [ ] 2.1 Export route (both Netscape plaintext and v10-encrypted targets); tests.
- [ ] 2.2 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-cookie-sqlite-io --strict`.
