## ADDED Requirements

### Requirement: The operating system's user-scoped protection is available to the backend

The shell MUST provide the operating system's user-scoped secret protection, so stored credentials remain readable.

#### Scenario: The protection is reachable from the backend
- **WHEN** the backend needs to protect or reveal a secret
- **THEN** it MUST be able to obtain the operating system's user-scoped cipher from the shell
- **AND** it MUST NOT require a desktop-runtime module to do so

#### Scenario: Scoping is per user
- **WHEN** a secret is protected
- **THEN** it MUST be protected for the current operating system user
- **AND** it MUST NOT be protected machine-wide

### Requirement: Existing stored secrets remain readable

Secrets written by the previous build MUST continue to decrypt.

#### Scenario: Legacy ciphertext decrypts
- **GIVEN** a stored secret produced by the previous build's protection mechanism
- **WHEN** it is revealed after the migration
- **THEN** the original plaintext MUST be returned
- **AND** the operator MUST NOT be required to re-enter it

#### Scenario: Compatibility is proven, not assumed
- **WHEN** compatibility is claimed
- **THEN** it MUST be demonstrated by decrypting a value produced by the previous build
- **AND** a claim resting only on reasoning MUST NOT be made

### Requirement: The fallback chain is preserved

Where the user-scoped protection is unavailable, the existing fallbacks MUST still apply.

#### Scenario: Fallback ordering
- **GIVEN** the user-scoped protection is unavailable
- **WHEN** a secret is protected
- **THEN** the local key-file mechanism MUST be used
- **AND** it MUST remain available for standalone and server deployments

#### Scenario: Unreadable values do not crash
- **GIVEN** a stored secret that cannot be decrypted
- **WHEN** it is revealed
- **THEN** the failure MUST be reported and no plaintext MUST be returned
- **AND** the caller MUST NOT be given a partially decrypted value
