# movable-data-root Specification

## ADDED Requirements

### Requirement: A discovered folder offers transfer, not only a switch
The recovery scan reports, for each candidate data folder, whether it is the folder currently
in use. Every candidate that is NOT the current folder AND holds at least one profile MUST be
actionable in two independent ways: transferred into the current folder, and (unchanged
behaviour) adopted as the working folder with a restart. A candidate holding zero profiles
MUST NOT offer transfer.

#### Scenario: Both actions offered for a populated foreign folder
- **GIVEN** a scan result containing the current folder and a foreign folder with three profiles
- **WHEN** the operator views the Data Folder panel
- **THEN** the foreign folder MUST offer a transfer action and the existing "use this folder" action, and the current folder MUST appear in neither list

#### Scenario: Empty folder offers no transfer
- **GIVEN** a scan result containing a foreign folder whose database holds zero profiles
- **WHEN** the operator views the row
- **THEN** the transfer action MUST be unavailable for that row
