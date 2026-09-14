# Design: Email Manager

## Key Decisions

1. **Hand-rolled minimal IMAP** over Node `tls`/`net`: 4 commands (LOGIN, SELECT, FETCH ENVELOPE, FETCH BODY) cover read-only workflows; library deps (imapflow) are large for a read-only feature and add sync risk.
2. **Vault storage**: credentials never in the DB in plaintext — wrapped via `protectSecret` (DPAPI on Windows) like proxy passwords.
3. **Code extraction**: regex set covering the dominant verification-code patterns (6-digit standalone, 8-char alphanum, "code is X" phrasings) + link extraction from confirm buttons; extractor is pure (tested without IMAP).
4. **Offline-safe listing**: listing works from the last sync cache when the server is unreachable; refresh on demand.
5. **Per-account single connection**: no pooling; the connection is opened per request and closed after — simple, no lingering sockets.

## Testing Strategy

- Fake IMAP server fixture (in-process net server speaking the minimal command set) for list/read tests; regex unit tests for the extractor (10+ real-world-shaped fixtures); vault roundtrip test.
