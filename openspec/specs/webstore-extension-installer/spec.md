# webstore-extension-installer Specification

## Purpose
Defines headless Chrome Web Store extension installation: input normalization, CRX acquisition over the update protocol, signature verification, versioned unpack, and registration in the extension manager.

## Requirements

### Requirement: Input normalization
The installer MUST accept a Web Store URL, a bare 32-character extension ID, or a local path, and MUST reject any other input with an explicit error.

#### Scenario: URL forms resolve to the same extension
- **GIVEN** `https://chromewebstore.google.com/detail/rabby-wallet/acmacodkjbdgmoleebolmdjonilkdbch` and the bare ID `acmacodkjbdgmoleebolmdjonilkdbch`
- **WHEN** normalizing both inputs
- **THEN** both MUST resolve to extension id `acmacodkjbdgmoleebolmdjonilkdbch`

#### Scenario: Local paths bypass the store
- **GIVEN** a local folder path
- **WHEN** normalizing
- **THEN** the input routes to the existing local importer and MUST NOT trigger any network fetch

### Requirement: CRX signature verification
The installer MUST verify the CRX container signature structure before unpacking and MUST NOT write unverified payloads to disk.

#### Scenario: Corrupt CRX rejected
- **GIVEN** a downloaded blob with an invalid CRX magic or header
- **WHEN** verification runs
- **THEN** installation fails with `BAD_SIGNATURE` and no files are created under `data/extensions/`

### Requirement: Versioned and idempotent registration
Unpacked extensions MUST be stored under `data/extensions/<id>/<version>/` and registered through the existing manager; re-installing the same id and version MUST be a no-op.

#### Scenario: Re-install is a no-op
- **GIVEN** extension `X` version 1.2.3 already installed
- **WHEN** installing `X` again with the same version
- **THEN** the response MUST report the existing registration and MUST NOT duplicate directories or manager rows
