# licensing delta

## ADDED Requirements

### Requirement: Offline license key validation

The license key SHALL be a base64url payload concatenated with an Ed25519 signature (`payload.signature`), validated offline with a public key embedded in the build (`src/main/licensing/publicKey.ts`). The private key is never committed; developers generate keypairs with `node:crypto` (documented in `.env.example` via `LICENSE_PRIVATE_KEY`).

#### Scenario: Valid Pro key activates
- **WHEN** a user submits a key whose signature verifies against the pinned public key and whose payload has not expired
- **THEN** the license state becomes `pro`, the payload is stored (secret store) and all Pro features unlock

#### Scenario: Tampered or foreign key is rejected
- **WHEN** the payload bytes are modified after signing, or the signature was made by a different key
- **THEN** activation fails with `INVALID_LICENSE` and the app stays in Free mode

#### Scenario: Expired key
- **WHEN** a validly-signed payload carries an `exp` in the past
- **THEN** activation fails with `LICENSE_EXPIRED`

#### Scenario: Key survives restart
- **WHEN** the app restarts after activation
- **THEN** the stored key is revalidated and Pro features remain unlocked without network access

### Requirement: Free/Pro feature gating

Free SHALL exclude teams and cloud sync. Pro SHALL include everything. Teams/sync API routes SHALL return `{code:"LICENSE_REQUIRED"}` when the license is Free.

#### Scenario: Free user cannot open teams
- **WHEN** a Free-license user calls any `/api/v1/teams*` or `/api/v1/sync*` endpoint
- **THEN** the response is `{code:"LICENSE_REQUIRED", msg:"Pro license required"}` and no team data is created or read

#### Scenario: Free user cannot sync bundles
- **WHEN** a Free user attempts a push or pull
- **THEN** the request is rejected with `LICENSE_REQUIRED` before any network call is made

#### Scenario: Pro unlocks teams and sync
- **WHEN** a valid Pro license is activated
- **THEN** teams, invites, workspace switching and bundle push/pull all operate normally

#### Scenario: License downgrade
- **WHEN** the license is removed or expires while team data exists locally
- **THEN** teams/sync routes return `LICENSE_REQUIRED`
- **AND** local personal profiles remain fully usable