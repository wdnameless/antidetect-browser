## Purpose

Defines the monochrome visual system: a single neutral token layer, surfaces separated without boxes, a grouped shell, one page-header primitive, and window chrome the app owns.

## ADDED Requirements

### Requirement: One neutral token layer
All chrome styling MUST resolve through a single token layer. No chrome value may carry a hue, and no style may reference a token that is not defined.

#### Scenario: No hue in chrome
- **WHEN** chrome styling is inspected
- **THEN** no hue-bearing colour literal MUST remain
- **AND** every value MUST resolve through the token layer

#### Scenario: No orphan tokens
- **WHEN** every referenced token is checked against the layer
- **THEN** each MUST be defined
- **AND** no inline fallback MUST reference a token that is absent

#### Scenario: Restyling is central
- **WHEN** a token value changes
- **THEN** every surface using it MUST change with it
- **AND** no page MUST need editing for that change

### Requirement: Surfaces are separated without boxes
Containers, controls and chips MUST NOT use full-perimeter borders or elevation. They MUST be separated by a background step and spacing instead. Thin horizontal dividers that carry structure MUST be retained.

#### Scenario: No box borders on chrome
- **WHEN** a container, control or chip is inspected
- **THEN** it MUST NOT draw a full-perimeter border
- **AND** it MUST NOT rely on elevation to separate itself

#### Scenario: Dividers survive
- **WHEN** a table, a form section, or a modal header is inspected
- **THEN** its separating hairline MUST be present
- **AND** adjacent rows or sections MUST remain visually delimited

#### Scenario: Controls stay legible without outlines
- **GIVEN** an input or button on the dark ground
- **WHEN** it is shown
- **THEN** its boundary MUST be perceptible without a border
- **AND** its focus state MUST be clearly distinguishable

#### Scenario: States survive without colour
- **WHEN** two states previously told apart by hue are shown together
- **THEN** they MUST remain distinguishable by weight, shape or icon
- **AND** this MUST NOT depend on the operator's colour vision

#### Scenario: Operator data is not chrome
- **WHEN** a colour the operator chose for their own data is displayed
- **THEN** it MUST be preserved unchanged

### Requirement: Navigation is grouped and complete
Navigation MUST be organised under labelled groups, and every page the application can show MUST be reachable from it.

#### Scenario: Grouped presentation
- **WHEN** the shell renders
- **THEN** navigation items MUST appear under labelled groups
- **AND** the current location MUST be evident

#### Scenario: Every page is reachable
- **WHEN** the set of navigable pages is compared with the set of groups of pages the application renders
- **THEN** they MUST be the same set
- **AND** no page MUST be reachable only by programmatic means

#### Scenario: Collapse still works
- **WHEN** the sidebar is collapsed and restored
- **THEN** the grouped presentation MUST survive
- **AND** the stored preference MUST still be honoured

### Requirement: One header per page
A page MUST present its location, title, a short statement of purpose and its actions exactly once, through a shared primitive.

#### Scenario: No duplicated title
- **WHEN** a page renders
- **THEN** exactly one title for it MUST be visible
- **AND** the shell MUST NOT render a second one

#### Scenario: Purpose is stated
- **WHEN** a page is shown
- **THEN** a short description of what the page is for MUST be present

#### Scenario: Actions are ordered by importance
- **WHEN** a page offers several actions
- **THEN** the primary action MUST be visually distinct from secondary ones without relying on hue

### Requirement: The window chrome belongs to the app
The application window MUST NOT present a native title bar or an application menu bar. The app MUST provide dragging and window controls itself.

#### Scenario: Native chrome is absent
- **WHEN** the window is shown
- **THEN** no native title bar or menu bar MUST be present

#### Scenario: The window remains operable
- **GIVEN** a frameless window
- **WHEN** the operator drags the header area
- **THEN** the window MUST move
- **AND** minimise, maximise and close MUST each work

#### Scenario: Tray behaviour is preserved
- **WHEN** the window is closed with the tray present
- **THEN** the app MUST behave as before, hiding rather than stranding itself
- **AND** restoring from the tray MUST still work

#### Scenario: Controls are not offered where they cannot act
- **GIVEN** the interface served to a browser rather than a desktop window
- **WHEN** it renders
- **THEN** window controls MUST NOT be presented

### Requirement: The sidebar reports the automation endpoint
The sidebar MUST expose the local automation API address with its live status, in a form the operator can read and copy.

#### Scenario: Address is shown and copyable
- **WHEN** the sidebar footer renders
- **THEN** the API address MUST be visible in a monospace face
- **AND** it MUST be copyable in one action

#### Scenario: Status is live
- **WHEN** the service is reachable
- **THEN** the indicator MUST show it
- **AND** MUST show when it is not
- **AND** the two MUST be distinguishable without colour
