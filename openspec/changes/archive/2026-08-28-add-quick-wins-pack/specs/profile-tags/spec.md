# profile-tags delta

## ADDED Requirements

### Requirement: Tag storage and many-to-many binding

The system SHALL store tags in `tags` (id, name, color, created_at) and bind them to profiles through `profile_tags` (profile_id, tag_id) with a composite primary key, allowing many profiles per tag and many tags per profile.

#### Scenario: Create a tag

- **WHEN** the user posts `POST /api/v1/tags` with `{name, color}`
- **THEN** a tag row is created and returned with its id

#### Scenario: Duplicate tag name is rejected

- **WHEN** a tag with the same name (case-insensitive) already exists
- **THEN** creation fails with `DUPLICATE`

#### Scenario: Delete a tag

- **WHEN** the user deletes a tag
- **THEN** its bindings in `profile_tags` are removed and profiles keep working

### Requirement: Attach, detach and filter

The API SHALL support attaching/detaching tags to profiles and filtering the profile list by tag: `GET /api/v1/browser/list?tag_id=<id>` returns only profiles carrying that tag.

#### Scenario: Attach a tag to profiles

- **WHEN** the user posts `POST /api/v1/tags/:id/attach` with `{user_ids: [...]}`
- **THEN** bindings are created idempotently (re-attach does not duplicate)

#### Scenario: Detach a tag from a profile

- **WHEN** the user posts `POST /api/v1/tags/:id/detach` with `{user_ids: [...]}`
- **THEN** the bindings are removed and the profile list no longer matches the tag filter

#### Scenario: Filter profiles by tag

- **WHEN** the user requests the profile list with `tag_id`
- **THEN** only bound profiles are returned, and the response items include their tag list

### Requirement: Tags UI

The renderer SHALL render tag chips in the Profiles table (with the tag color), provide a tag filter dropdown in the existing filter bar, and a tag management modal (create/rename/recolor/delete) consistent with the Groups UI style.

#### Scenario: Operator filters by tag

- **WHEN** the operator selects a tag in the filter dropdown
- **THEN** the table shows only profiles carrying the tag

#### Scenario: Operator manages tags

- **WHEN** the operator opens tag management, creates a tag with a color and deletes another
- **THEN** the chips and filter options reflect the change on next load