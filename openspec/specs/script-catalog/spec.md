# script-catalog Specification

## Purpose
TBD - created by archiving change add-script-engine-catalog. Update Purpose after archive.

## Requirements

### Requirement: Catalog manifest from GitHub raw

The system SHALL fetch the script catalog as a JSON manifest `{scripts: [{id, name, description, tags[], version, url, checksum_sha256}]}` from a configurable GitHub raw URL (constant in config, user-editable in Settings; a default stub URL ships disabled/failing gracefully). `GET /api/v1/catalog` SHALL return the parsed manifest or a structured error when the URL is unreachable.

#### Scenario: Manifest loads

- **WHEN** the configured URL serves valid manifest JSON
- **THEN** `GET /api/v1/catalog` returns the script cards (id, name, description, tags, version) ready for review

#### Scenario: Unreachable URL fails gracefully

- **WHEN** the catalog URL cannot be fetched or parsed
- **THEN** the API answers with a structured error and the UI shows an empty/error state — nothing crashes

### Requirement: Install with checksum verification

`POST /api/v1/catalog/install {catalog_id}` SHALL fetch the script code from the manifest URL, compute sha256, and compare with `checksum_sha256`; on mismatch the API SHALL answer `code:"CHECKSUM_MISMATCH"` and NOT store anything. The script code SHALL always be viewable in the UI before installation and stored only after an explicit Install click (writing into the `scripts` table).

#### Scenario: Install succeeds with matching checksum

- **WHEN** the fetched code's sha256 equals the manifest checksum
- **THEN** the script is stored in `scripts` with the manifest name and the install returns the new script id

#### Scenario: Checksum mismatch blocks install

- **WHEN** the fetched code's sha256 differs from the manifest checksum
- **THEN** the response is `code:"CHECKSUM_MISMATCH"` and no script row is created

#### Scenario: Code is reviewed before install

- **WHEN** the user opens the catalog entry's View code action
- **THEN** the full script source is shown in a modal before any install button takes effect
- **AND** installation happens only on the explicit Install click

### Requirement: Catalog URL setting

The Settings page SHALL provide a field to change the catalog URL, persisted in app settings; the engine uses the current value on every catalog fetch.

#### Scenario: User points the catalog at their own repo

- **WHEN** the user saves a new catalog URL in Settings
- **THEN** subsequent catalog fetches use the new URL
