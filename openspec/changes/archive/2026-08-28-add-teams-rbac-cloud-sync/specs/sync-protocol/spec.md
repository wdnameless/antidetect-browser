# sync-protocol delta

## ADDED Requirements

### Requirement: Encrypted bundle wire-format v1

The client SHALL encrypt profile bundles with AES-256-GCM using a team key derived with HKDF-SHA256 from the team master key (generated at team creation and exported to invitees in encrypted form). The server SHALL store only `{bundle_id, team_id, device_id, ciphertext, nonce, version, updated_at}` and never receive or store plaintext.

#### Scenario: Team master key lifecycle
- **WHEN** a team is created
- **THEN** a random 32-byte master key is generated locally and stored in the local secret store
- **AND** during an invite the master key is wrapped with a key derived from the activation code (HKDF) and shipped to the server for the invitee to unwrap

#### Scenario: Push encrypts before leaving the device
- **WHEN** a profile bundle is pushed
- **THEN** the bundle JSON is serialized, encrypted with AES-256-GCM (random 12-byte nonce, auth tag appended) and only `{ciphertext, nonce}` travel to the server
- **AND** the server response never contains a decryption capability

#### Scenario: Pull decrypts locally only
- **WHEN** bundles are pulled
- **THEN** the client decrypts each ciphertext locally with the team key
- **AND** a bundle encrypted with a stale/foreign team key fails decryption with an authentication error and is skipped

#### Scenario: Server is zero-knowledge
- **WHEN** the server DB is inspected
- **THEN** only ciphertext and metadata are present; no profile name, proxy or cookie field is recoverable without the team key

### Requirement: REST sync API with versioning and conflict resolution

The system SHALL expose `POST /api/v1/teams`, `POST /teams/:id/invites`, `POST /invites/accept`, `POST /teams/:id/bundles` (push), `GET /teams/:id/bundles?since=` (pull), with per-bundle versions and last-write-wins conflict resolution by `updated_at`.

#### Scenario: Push a new bundle version
- **WHEN** a client pushes a bundle_id that already exists with an older version
- **THEN** the row is updated, version increments and `updated_at` is refreshed
- **AND** the server responds with the new version number

#### Scenario: Stale write loses (last-write-wins)
- **WHEN** two devices push different payloads for the same bundle_id
- **THEN** the row keeps the payload with the greatest `updated_at` (ties broken by version)
- **AND** the losing client learns the winning version on its next pull

#### Scenario: Incremental pull
- **WHEN** `GET /teams/:id/bundles?since=<timestamp>` is called
- **THEN** only bundles with `updated_at > since` are returned, newest first
- **AND** the client persists the max `updated_at` as its sync cursor

#### Scenario: Team isolation on the server
- **WHEN** a device requests bundles of a team it is not an active member of
- **THEN** the server rejects the request with `FORBIDDEN` and returns no metadata

### Requirement: Endpoint configuration cloud or custom

The system SHALL support endpoint configuration with a cloud mode (default URL) and a custom mode (self-host URL), switchable in Settings.

#### Scenario: Switch endpoint mode
- **WHEN** the user selects `custom` and saves a base URL in Settings → Sync
- **THEN** all team/sync REST calls are redirected to that base URL
- **AND** switching back to `cloud` restores the default URL

#### Scenario: Connection status is visible
- **WHEN** the user opens Settings → Sync
- **THEN** the current mode, URL and a live connection status (reachable / unreachable) are shown
- **AND** an unreachable endpoint never blocks local profile operations