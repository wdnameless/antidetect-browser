# movable-data-root Specification

## Purpose
Defines verified relocation of the data root: running-profile gating, copy-verify-swap semantics, progress and cancellation, and absolute-path rewriting, with the old root never destroyed before the new one proves readable.

## Requirements

### Requirement: Running profiles block relocation
A move MUST refuse to start while any profile browser is running and MUST prevent concurrent moves via an exclusive lock.

#### Scenario: Move refused with running profile
- **GIVEN** one running profile and a move request
- **WHEN** the mover evaluates the gate
- **THEN** the move MUST be refused with an explicit running-profile error and no files MUST be copied

### Requirement: Copy-verify-swap integrity
The old data root MUST remain authoritative until the new root passes a reopen-and-read verification; any verification failure MUST abort the move leaving the old root intact.

#### Scenario: Verify failure aborts without data loss
- **GIVEN** a copy phase that completed but a verification that finds a byte mismatch
- **WHEN** verification runs
- **THEN** the move MUST abort with the old root untouched and still authoritative, the target marked incomplete, and the data-root setting unchanged

### Requirement: Cancellation cleans partial state
Cancelling mid-copy MUST stop at a file checkpoint, clean the partial target, and leave the data-root setting unchanged.

#### Scenario: Cancel mid-copy
- **GIVEN** a copy in progress
- **WHEN** cancellation is requested
- **THEN** copying stops at the next file boundary, the partial target is removed, and the old root remains the active data root
