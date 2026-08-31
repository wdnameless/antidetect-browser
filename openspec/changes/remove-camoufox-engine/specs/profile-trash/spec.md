## MODIFIED Requirements

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
