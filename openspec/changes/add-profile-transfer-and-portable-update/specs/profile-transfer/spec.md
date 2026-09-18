# profile-transfer Specification

## Purpose
Defines bringing profiles from another data folder into the folder currently in use: what
travels with a profile, how collisions are handled, and what the operator is told about the
result. Distinct from relocating the data root — the folder in use never changes.

## ADDED Requirements

### Requirement: Profiles import into the folder in use
The system MUST import profiles from a chosen foreign data folder into the data folder
currently in use, leaving the data-root setting, the foreign folder, and every profile already
present in the destination untouched.

#### Scenario: Profiles appear without restarting
- **GIVEN** a foreign folder holding three profiles and a destination holding none
- **WHEN** the operator transfers that folder
- **THEN** the profiles MUST be readable from the running application immediately, with the
  data-root setting unchanged and the foreign folder still holding its three profiles

### Requirement: Dependencies travel with the profile
Every row a transferred profile references — its fingerprint, device, proxy and group — MUST
be present in the destination afterwards, so a transferred profile can be launched. A
referenced row that does not exist in the source MUST NOT prevent the profile from importing;
the reference resolves to absent, exactly as it does in the source.

#### Scenario: Fingerprint and device arrive with the profile
- **GIVEN** a source profile referencing a fingerprint and a device that exist only in the source
- **WHEN** the profile is transferred
- **THEN** the destination MUST hold that fingerprint and that device, and the profile's
  recorded references MUST resolve

#### Scenario: Dangling reference does not block the import
- **GIVEN** a source profile whose `proxy_id` names a proxy absent from the source database
- **WHEN** the profile is transferred
- **THEN** the profile MUST be imported with that reference left unresolved, and MUST NOT be
  counted as skipped

### Requirement: Existing profiles are never overwritten
A source profile whose identifier already exists in the destination MUST be skipped, and the
result MUST report it as skipped rather than as created. Transferring the same folder twice
MUST create nothing the second time.

#### Scenario: Second transfer of the same folder creates nothing
- **GIVEN** a folder that was already transferred once
- **WHEN** it is transferred again
- **THEN** the reported created count MUST be zero and the destination MUST be unchanged

#### Scenario: A local edit survives a transfer
- **GIVEN** a destination profile whose id also exists in the source, with destination-specific
  data (a different name)
- **WHEN** the folder is transferred
- **THEN** the destination row MUST keep its own values and the profile MUST be reported as skipped

### Requirement: A transfer reports what it actually did
The result MUST report counts of created and skipped profiles, MUST name the folder the import
came from, and MUST report a failure explicitly — an unreadable, missing or corrupt source
database, and a source that is the folder already in use, MUST each produce a stated error
rather than a zero-count success.

#### Scenario: Missing source database is an error, not silence
- **GIVEN** a folder that no longer exists, or whose database is unreadable
- **WHEN** a transfer is requested from it
- **THEN** the response MUST state the failure, and MUST NOT report created profiles

#### Scenario: Transferring the folder already in use is refused
- **GIVEN** the data folder currently in use
- **WHEN** a transfer from it is requested
- **THEN** the request MUST be refused with an explicit message and no rows MUST be written
