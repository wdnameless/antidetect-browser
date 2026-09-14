## Purpose

Defines direct Chromium Cookies SQLite import/export with v10 AES-GCM decrypt/encrypt and DPAPI key unwrap, with merge (upsert) semantics and running-profile refusal.

## ADDED Requirements

### Requirement: v10 roundtrip preserves cookie values
A cookie value encrypted with a known AES-GCM key under the v10 scheme MUST decrypt to the original plaintext.

#### Scenario: Known-key roundtrip
- **GIVEN** a cookie value encrypted with a fixed key under v10
- **WHEN** decrypted
- **THEN** the plaintext MUST equal the original value byte-for-byte

### Requirement: Import merges, never wipes
Importing a Cookies DB MUST upsert by (name, host_key, path) and MUST leave every other row in the target untouched.

#### Scenario: Merge preserves untouched rows
- **GIVEN** a target Cookies DB with a row not present in the source
- **WHEN** the import runs
- **THEN** the untouched row MUST survive byte-identical

### Requirement: Running profiles refuse writes
Import and export MUST refuse any profile whose browser is currently running.

#### Scenario: Running profile rejected
- **GIVEN** a running profile
- **WHEN** a cookie DB import targets it
- **THEN** the route MUST respond with an explicit running-profile error and no write MUST occur