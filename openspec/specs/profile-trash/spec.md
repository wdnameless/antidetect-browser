# profile-trash Specification

## Purpose
TBD - created by archiving change add-quick-wins-pack. Update Purpose after archive.

## Requirements

### Requirement: Soft delete

Deleting a profile SHALL set `profiles.deleted_at` instead of removing the row. All profile list/detail/launch paths SHALL exclude rows where `deleted_at IS NOT NULL`. Deletion SHALL NOT destroy fingerprints, extensions bindings, credentials, or profile user-data on disk.

#### Scenario: Delete moves to trash

- **WHEN** the user deletes a profile (single or bulk)
- **THEN** the row remains with `deleted_at` set to the current time and disappears from all normal lists

#### Scenario: Launching a trashed profile is refused

- **WHEN** a start/duplicate/update is requested for a trashed profile
- **THEN** the operation fails as "profile not found"

### Requirement: Trash listing, restore and purge

The API SHALL preserve existing trash list and restore behavior. Ordinary permanent deletion and 30-day purge MUST NOT delete data registered in durable `preserved_browser_data`, which is independent of profile/trash metadata and survives their purge. Registered data is preserved indefinitely and removed only by the separately authenticated, typed-confirmed, audited cleanup workflow.

#### Scenario: Negative input - ordinary permanent delete
- **WHEN** ordinary trash purge targets a profile with preserved engine data
- **THEN** raw data MUST remain and the response MUST report preservation status

#### Scenario: State or race - purge overlaps cleanup
- **WHEN** automatic purge races explicit cleanup
- **THEN** one journal owner MUST win and no partial/double deletion MUST occur

#### Scenario: Boundary or null - unknown preservation mapping
- **WHEN** a legacy row has raw Firefox data but a null or unknown preservation mapping
- **THEN** purge MUST fail closed for raw data and flag inventory repair

#### Scenario: Auth or permission - cleanup through trash endpoint
- **WHEN** any caller attempts raw Firefox cleanup through the ordinary trash endpoint
- **THEN** it MUST be refused regardless of trash permission and direct the caller to scoped cleanup

#### Scenario: Restore a profile
- **WHEN** an authorized user restores a compatible trashed profile
- **THEN** `deleted_at` is cleared with tags/credentials intact

#### Scenario: Automatic purge after 30 days
- **WHEN** startup finds a non-preserved compatible profile older than 30 days
- **THEN** existing permanent purge semantics remain unchanged

#### Scenario: Delete forever
- **WHEN** an authorized user permanently deletes a non-preserved compatible trashed profile
- **THEN** its row, fingerprint, bindings, credentials, and compatible user-data directory MUST be removed

### Requirement: Trash UI

The renderer SHALL provide a Trash page listing deleted profiles (name and deletion date) with Restore and Delete-forever actions.

#### Scenario: Operator restores from trash

- **WHEN** the operator clicks Restore on a trashed profile
- **THEN** it disappears from the Trash list and reappears in Profiles
