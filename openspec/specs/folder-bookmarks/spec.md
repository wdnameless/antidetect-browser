# folder-bookmarks Specification

## Purpose
Defines folder-scoped shared bookmarks: a registry per group, a managed bookmark folder merged into member profiles at launch, and strict preservation of user bookmark data.

## Requirements

### Requirement: Managed-node merge preserves user data
The launcher MUST modify only its managed bookmark node in the profile's `Bookmarks` file, leaving all user nodes byte-identical, and MUST produce the same result on consecutive launches.

#### Scenario: User bookmarks survive repeated launches
- **GIVEN** a profile whose `Bookmarks` tree contains user nodes and a previously written managed node
- **WHEN** the profile launches twice with an updated folder registry
- **THEN** the managed node MUST reflect the latest registry after each launch and every user node MUST remain byte-identical

### Requirement: Corrupt bookmark file is quarantined, not destroyed
A malformed `Bookmarks` JSON MUST be renamed to a `.bak` copy once, after which a fresh tree containing only the managed node is written.

#### Scenario: Malformed file handled
- **GIVEN** a profile with a corrupt `Bookmarks` file
- **WHEN** the profile launches
- **THEN** `Bookmarks.pre-managed.bak` MUST exist, the new file MUST be valid JSON containing the managed node, and the launch MUST NOT fail
