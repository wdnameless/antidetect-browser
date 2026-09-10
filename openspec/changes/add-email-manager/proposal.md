## Why

Afina ships an email manager (IMAP client, credential storage, per-account inbox, message reading, forwarding). Operators binding emails to profiles need to read verification codes without opening the profile browser — this is the workflow's chokepoint.

## What Changes

- `src/main/email/manager.ts`: IMAP client (hand-rolled minimal: LOGIN, SELECT INBOX, FETCH ENVELOPE+BODY, single connection per account, TLS over 993) with inbox listing, message body read, and a **verification-code extractor** (common 6-digit/8-char patterns + "confirm your email" links).
- Credential storage in the existing vault (secrets encrypted via DPAPI secretStore).
- API: account CRUD (`/api/v1/email/accounts`), inbox list (`/api/v1/email/accounts/:id/inbox`), message read (`/api/v1/email/accounts/:id/messages/:uid`), code extract (`/api/v1/email/accounts/:id/codes`).
- Renderer: Email page (account list, inbox, message view, code chip with one-click copy).

## Capabilities

### New Capabilities
- `email-manager`: IMAP account management, inbox read, message body, verification-code extraction.

### Modified Capabilities
- `account-vault`: email credentials stored under the vault's secret namespace.

## Impact

- `src/main/email/` (new), routes, Email page, tests in `tests/unit/email/` with a fake IMAP server fixture (in-process TCP mock server speaking the 4-command subset).