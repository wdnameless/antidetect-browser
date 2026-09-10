## Purpose

Defines the read-only email manager: minimal IMAP client over TLS, vault-backed credentials, verification-code extraction, and an Email page.

## ADDED Requirements

### Requirement: Credentials never live in plaintext storage
Email passwords MUST be stored via the vault's `protectSecret` (DPAPI on Windows) and MUST appear nowhere in DB rows in plaintext.

#### Scenario: Account saved, DB inspected
- **GIVEN** an email account created with a password
- **WHEN** the DB row is read directly
- **THEN** the stored value MUST NOT equal the plaintext password

### Requirement: Verification-code extraction is pure and deterministic
The extractor MUST be a pure function of the message text and MUST return codes matching the dominant real-world patterns (standalone 6-digit, 8-char alphanum, "code is X" phrasings).

#### Scenario: Common patterns extracted
- **GIVEN** fixtures for each pattern class
- **WHEN** the extractor runs
- **THEN** each fixture MUST yield its code (and links when present)

### Requirement: Listing works offline from cache
When the IMAP server is unreachable, the inbox list MUST return the last synced state marked as cached instead of failing.

#### Scenario: Server offline, list returns cache
- **GIVEN** an account whose server is unreachable
- **WHEN** the inbox is requested
- **THEN** the response MUST contain the cached rows and a `cached: true` marker