## Purpose

Defines the product's name, taglines and icon, and — critically — the boundary of what a rename may NOT touch, because some identifiers carry cryptographic or on-disk meaning.

## ADDED Requirements

### Requirement: The product is named NullTrace
Every user-visible surface MUST present the product as NullTrace.

#### Scenario: Interface surfaces
- **WHEN** the interface renders
- **THEN** the window/page title, the brand block and the loading state MUST all read NullTrace
- **AND** the previous name MUST NOT appear

#### Scenario: Localised surfaces agree
- **WHEN** the interface is viewed in any supported language
- **THEN** the product name MUST be consistent across all of them
- **AND** no language MUST retain the previous name

#### Scenario: Artefacts that leave the machine
- **WHEN** the product writes an exported artefact that carries a product header or filename
- **THEN** it MUST carry the NullTrace identity

### Requirement: Taglines are used as specified
The primary tagline MUST be "Zero footprint, infinite scale." The secondary MUST be "Leave nothing behind."

#### Scenario: Primary placement
- **WHEN** a tagline is shown as the product's main line
- **THEN** it MUST be the primary tagline

#### Scenario: Single definition
- **WHEN** the taglines are needed in more than one place
- **THEN** they MUST come from one definition rather than being duplicated

### Requirement: The icon is generated from one master
A single vector master MUST be the source of every icon artefact the product ships.

#### Scenario: Every format derives from the master
- **WHEN** the icon set is inspected
- **THEN** every artefact MUST derive from the same master
- **AND** the set MUST NOT be hand-edited per format

#### Scenario: The icon is monochrome
- **WHEN** the icon is inspected
- **THEN** it MUST contain no hue, matching the noir direction

#### Scenario: No stale identity remains
- **WHEN** the interface is served
- **THEN** its favicon MUST be the current mark
- **AND** MUST NOT be a superseded one

### Requirement: Renaming does not invalidate data or signatures
Identifiers whose values carry cryptographic meaning or locate on-disk state MUST NOT change value as part of the rename.

#### Scenario: Fingerprint derivation is stable
- **GIVEN** a profile created before the rename
- **WHEN** its fingerprint is derived after the rename
- **THEN** the result MUST be identical
- **AND** the derivation constant MUST have kept its value

#### Scenario: Release verification still holds
- **WHEN** a previously signed artefact is verified after the rename
- **THEN** verification MUST still succeed
- **AND** the signing domain MUST have kept its value

#### Scenario: Existing installations keep their data
- **WHEN** the product starts after the rename on an installation that has data
- **THEN** it MUST find and use that data
- **AND** MUST NOT create a parallel empty store

#### Scenario: The reason is recorded at each site
- **WHEN** a kept identifier is read in the source
- **THEN** the reason it was kept MUST be documented there
