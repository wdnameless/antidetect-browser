## Purpose

Defines capture of a real browsing session into editable flow steps, and the on-demand element action picker.

## ADDED Requirements

### Requirement: Recording is off unless explicitly started
The launcher MUST NOT inject a listener, open a capture channel, or observe input for a profile that is not being recorded.

#### Scenario: No capture when idle
- **GIVEN** a profile running while recording is off
- **WHEN** the operator interacts with it
- **THEN** no action MUST be captured
- **AND** no listener MUST be present in the page

#### Scenario: Capture stops with recording
- **WHEN** recording is stopped
- **THEN** the channel MUST close and the listener MUST stop reporting

### Requirement: Captured actions become flow nodes
Each captured action MUST materialise as a flow node of the matching type, using a selector derived the same way the existing selector-path scheme derives one, so a recorded step is editable exactly like a hand-made one.

#### Scenario: A click becomes a click node
- **GIVEN** recording is active
- **WHEN** the operator clicks an element
- **THEN** a node of the matching click type MUST be appended with a selector resolving to that element

#### Scenario: A typing burst becomes one node
- **GIVEN** the operator types a string into one field
- **WHEN** capture completes
- **THEN** exactly one type node MUST be produced carrying the full text
- **AND** MUST NOT produce one node per keystroke

#### Scenario: Navigation is captured
- **WHEN** the page navigates to a new URL during recording
- **THEN** a navigate node MUST be appended for it

#### Scenario: Non-actions are ignored
- **WHEN** an observed event cannot be expressed as a step (an untargeted scroll, a modifier key alone)
- **THEN** no node MUST be appended for it

### Requirement: Recorded steps are reviewable before they are kept
The operator MUST be able to discard, reorder, or edit a captured step before saving the flow.

#### Scenario: Discard a step
- **WHEN** the operator discards a captured step
- **THEN** it MUST NOT appear in the saved document

#### Scenario: Edit a captured step
- **WHEN** the operator edits a captured step's configuration
- **THEN** the edited value MUST be what the saved document contains

### Requirement: Element action picker
The operator MUST be able to choose an action for a specific element on demand, independently of recording.

#### Scenario: Pick an action for an element
- **GIVEN** a running profile with recording off
- **WHEN** the operator invokes the picker on an element
- **THEN** the available actions MUST be offered for that element
- **AND** the chosen action MUST be appended as a node with that element's selector prefilled

#### Scenario: Picker targets the element under the cursor
- **WHEN** the operator invokes the picker over a nested element
- **THEN** the selector MUST resolve to the element actually under the cursor, not an ancestor
