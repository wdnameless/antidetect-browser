# account-vault Specification

## Purpose
TBD - created by archiving change add-quick-wins-pack. Update Purpose after archive.

## Requirements

### Requirement: Encrypted credential storage

The system SHALL store per-profile account credentials in an `account_credentials` table (id, profile_id FK, label, login, password_enc, totp_secret_enc, notes, created_at, updated_at). Passwords and TOTP secrets SHALL be encrypted with AES-256-GCM through the existing machine-local secret store (`util/secretStore.ts`); plaintext SHALL never be written to the database.

#### Scenario: Create a credential entry

- **WHEN** an authenticated user posts `POST /api/v1/accounts/:profileId` with `{label, login, password, totp_secret?, notes?}`
- **THEN** a row is created with `password_enc` and `totp_secret_enc` produced by `protectSecret()` (AES-256-GCM)
- **AND** the response contains the entry id and no plaintext secret fields

#### Scenario: Update a credential entry

- **WHEN** the user posts an update with a new password
- **THEN** the new value is re-encrypted and stored; unchanged fields are preserved

#### Scenario: Delete a credential entry

- **WHEN** the user deletes an entry by id
- **THEN** the row is removed and the profile keeps its other entries

### Requirement: Masked listing and explicit reveal

List responses SHALL mask secrets (only `******` is returned); plaintext SHALL be exposed only through a dedicated reveal endpoint.

#### Scenario: List masks secrets

- **WHEN** the user requests `GET /api/v1/accounts/:profileId`
- **THEN** each item contains `has_password`/`has_totp` booleans and `password`/`totp_secret` are absent

#### Scenario: Reveal a secret

- **WHEN** the user requests `GET /api/v1/accounts/:profileId/:entryId/reveal?field=password`
- **THEN** the decrypted value is returned exactly once in the response
- **AND** an unknown field name is rejected with `INVALID_FIELD`

### Requirement: Vault UI in the profile drawer

The renderer SHALL provide a Vault tab in the profile drawer listing the profile's credentials with add/edit/delete, reveal-on-click with copy-to-clipboard, and masked display by default.

#### Scenario: Operator reveals a password

- **WHEN** the operator clicks the reveal (eye) button next to a stored password
- **THEN** the decrypted value is fetched and shown briefly with a copy action

#### Scenario: Operator adds an entry

- **WHEN** the operator fills label/login/password and saves
- **THEN** the entry appears in the table with masked secrets
