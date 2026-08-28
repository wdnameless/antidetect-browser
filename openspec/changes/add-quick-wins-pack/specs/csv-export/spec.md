# csv-export delta

## ADDED Requirements

### Requirement: CSV export of the profile list

The system SHALL provide `GET /api/v1/profiles/export-csv` returning a CSV with headers `id,name,platform,proxy,group,tags,created_at` covering all non-deleted profiles visible to the operator. Fields containing commas, quotes or newlines SHALL be quoted with doubled quotes, mirroring the escaping rules of the existing `parseCsv` importer so the export round-trips through the import.

#### Scenario: Export produces parseable CSV

- **WHEN** the user requests the export with at least one profile whose name contains a comma or quote
- **THEN** the response is `text/csv` with a header row and every such value wrapped in double quotes with inner quotes doubled

#### Scenario: Export respects trash

- **WHEN** profiles exist in the trash
- **THEN** they are not included in the export

#### Scenario: Empty list yields header only

- **WHEN** no profiles exist
- **THEN** the response contains only the header row

### Requirement: Export UI

The renderer SHALL provide an Export CSV button in the Profiles bulk/header bar that downloads the file as `antidetect-profiles-<date>.csv`.

#### Scenario: Operator downloads the CSV

- **WHEN** the operator clicks Export CSV
- **THEN** a file download is triggered with today's date in the filename