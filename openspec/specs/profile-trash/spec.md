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

The API SHALL provide `GET /api/v1/trash` (list of deleted profiles with name + deleted_at), `POST /api/v1/trash/:id/restore`, and `DELETE /api/v1/trash/:id` (permanent removal including fingerprint, bindings and user-data directory). Records older than 30 days SHALL be purged automatically on service start.

#### Scenario: Restore a profile

- **WHEN** the user restores a trashed profile
- **THEN** `deleted_at` is cleared and the profile reappears in normal lists with its tags/credentials intact

#### Scenario: Delete forever

- **WHEN** the user permanently deletes a trashed profile
- **THEN** the row, its fingerprint row, extension bindings and account credentials are removed and the profile data directory is removed from disk

#### Scenario: Automatic purge after 30 days

- **WHEN** the service starts and a trashed profile has `deleted_at` older than 30 days
- **THEN** it is permanently deleted and the count is logged

### Requirement: Trash UI

The renderer SHALL provide a Trash page listing deleted profiles (name and deletion date) with Restore and Delete-forever actions.

#### Scenario: Operator restores from trash

- **WHEN** the operator clicks Restore on a trashed profile
- **THEN** it disappears from the Trash list and reappears in Profiles
