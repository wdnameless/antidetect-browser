## Purpose

Defines Excel (.xlsx) import/export for profiles and proxies: a minimal hand-rolled OOXML reader/writer with deterministic output, strict reader, and no new dependencies.

## ADDED Requirements

### Requirement: Deterministic OOXML writer
The writer MUST emit a single-sheet workbook whose rows open identically in Excel, LibreOffice, and the system's own reader.

#### Scenario: Roundtrip preserves rows
- **GIVEN** 3 profiles with name, timezone, and proxy host set
- **WHEN** exported to .xlsx and re-imported
- **THEN** the imported rows MUST match the source on every written column

#### Scenario: Writer output is byte-stable
- **GIVEN** the same input rows
- **WHEN** exported twice
- **THEN** both outputs MUST be byte-identical

### Requirement: Reader tolerates shared and inline strings
The reader MUST parse both shared-string-table cells and inline strings, and MUST reject non-zip input with a typed error.

#### Scenario: Both cell encodings read identically
- **GIVEN** two fixtures encoding the same rows with shared strings vs inline strings
- **WHEN** read
- **THEN** both MUST produce identical row arrays