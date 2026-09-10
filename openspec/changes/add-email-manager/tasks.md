## 1. IMAP client and extractor

- [ ] 1.1 Minimal IMAP client (LOGIN, SELECT, FETCH ENVELOPE, FETCH BODY) over TLS with injectable socket seam; tests against the fake IMAP fixture.
- [ ] 1.2 Verification-code + confirm-link extractor (pure function) with 10+ real-world-shaped fixtures; unit tests.
- [ ] 1.3 Vault-backed account CRUD + API routes (accounts, inbox, message, codes); route tests.

## 2. UI and verification

- [ ] 2.1 Email page: accounts, inbox, message read, code chip copy; component check.
- [ ] 2.2 Full suite green + typecheck clean; CHANGELOG; `openspec validate add-email-manager --strict`.
