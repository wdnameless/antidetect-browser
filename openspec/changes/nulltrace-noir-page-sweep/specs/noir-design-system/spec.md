## ADDED Requirements

### Requirement: Page chrome is token-driven
Every chrome value on every page MUST resolve through the token layer. A literal colour in page chrome MUST NOT remain, and a token reference MUST NOT carry a colour fallback.

#### Scenario: No literal chrome colour in a page
- **WHEN** every renderer source file is inspected
- **THEN** no chrome colour literal MUST remain
- **AND** every chrome value MUST resolve through a token

#### Scenario: No orphan reference
- **WHEN** a `var()` reference is resolved
- **THEN** the token it names MUST be defined
- **AND** the reference MUST NOT supply its own fallback colour

#### Scenario: A restyle reaches the pages
- **WHEN** a token value changes
- **THEN** every page using it MUST change with it
- **AND** no page source MUST need editing for that change

### Requirement: Operator data colours are not chrome
Colours the operator chose for their own data MUST be preserved exactly, and MUST NOT be replaced by a token value.

#### Scenario: A chosen colour survives
- **GIVEN** a profile or tag with an operator-chosen colour
- **WHEN** it is displayed after the sweep
- **THEN** its colour MUST be unchanged

#### Scenario: The guard does not demand their removal
- **WHEN** the chrome hue guard runs
- **THEN** it MUST NOT flag operator data colours
- **AND** the distinction MUST be made by identifying the palette's source, not by exempting a file by name

### Requirement: Meaning survives the loss of colour
Where colour carried meaning — validity, running state, node kind — the meaning MUST be preserved by another means, and MUST remain distinguishable.

#### Scenario: Validation stays legible
- **GIVEN** a valid and an invalid element shown together
- **WHEN** they are compared
- **THEN** the difference MUST be perceptible without hue
- **AND** the underlying valid/invalid logic MUST be unchanged

#### Scenario: Run state stays legible
- **WHEN** a running and a stopped element are shown together
- **THEN** they MUST be distinguishable without hue
- **AND** the condition driving them MUST be unchanged

#### Scenario: Diagram markup is not exempt
- **WHEN** a colour value appears in an SVG presentation attribute
- **THEN** it MUST still resolve through the token layer
- **AND** the fact that such attributes do not inherit CSS variables MUST be handled rather than ignored

#### Scenario: Node kinds stay distinguishable
- **WHEN** different node kinds appear on the canvas
- **THEN** each kind MUST be identifiable at a glance
- **AND** the distinction MUST NOT rely on telling six near-identical greys apart

### Requirement: One title and one empty state per surface
A page MUST present exactly one title, and an empty list MUST use one shared empty-state presentation.

#### Scenario: No duplicate title
- **WHEN** any page renders
- **THEN** exactly one title for it MUST be visible

#### Scenario: Empty state is shared
- **WHEN** a page has nothing to show
- **THEN** it MUST use the shared empty-state presentation
- **AND** it MUST state what the page is for and what to do next
