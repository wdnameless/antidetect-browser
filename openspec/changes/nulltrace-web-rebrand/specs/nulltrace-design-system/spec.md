## Purpose

Defines the monochrome noir visual system: a neutral token layer, a ShardX-shaped shell, and the primitives that stop each page re-inventing its own chrome.

## ADDED Requirements

### Requirement: The palette is hue-free
No chrome surface SHALL carry a hue. The system MUST be black, white and a grey ramp only. Semantic states MUST therefore be expressed without colour.

#### Scenario: No coloured chrome
- **WHEN** chrome styling is inspected
- **THEN** no hue-bearing colour literal MUST remain
- **AND** every chrome value MUST come from the token layer

#### Scenario: States remain distinguishable without colour
- **WHEN** two states that were previously distinguished by colour are shown together
- **THEN** they MUST remain distinguishable by weight, shape, icon or the grey ramp
- **AND** a user MUST NOT need colour vision to tell them apart

#### Scenario: Operator data is not chrome
- **WHEN** a colour the operator chose for their own data is displayed
- **THEN** it MUST be preserved
- **AND** the system MUST NOT overwrite it with a token value

### Requirement: One token layer
All chrome styling MUST resolve through a single token layer. Ad-hoc fallback variables that reference tokens which do not exist are forbidden, because they silently collapse during a restyle.

#### Scenario: No orphan tokens
- **WHEN** the stylesheet is inspected
- **THEN** every token referenced MUST be defined
- **AND** no inline style MUST reference a token that is absent from the layer

#### Scenario: Restyling is central
- **WHEN** a token value changes
- **THEN** every surface using it MUST change with it
- **AND** no page MUST need editing for that change

### Requirement: The shell groups navigation
Navigation MUST be grouped under labelled sections rather than presented as one flat list.

#### Scenario: Grouped navigation
- **WHEN** the shell renders
- **THEN** navigation items MUST appear under labelled groups
- **AND** the current location MUST be evident

#### Scenario: Page context is stated
- **WHEN** a page is shown
- **THEN** the header MUST present its location, its title, a short statement of its purpose, and its actions
- **AND** the primary action MUST be visually distinct from secondary ones without relying on hue

#### Scenario: Density matches the reference
- **WHEN** the shell is compared with the reference
- **THEN** its spacing, border subtlety and type hierarchy MUST follow the same ordering
- **AND** it MUST NOT reproduce the reference's accent colour

### Requirement: Shared primitives exist once
Repeated interface elements MUST be shared components rather than re-implemented per page.

#### Scenario: A primitive is not duplicated
- **WHEN** the same interface element appears on two pages
- **THEN** it MUST be the same component
- **AND** MUST NOT be re-implemented inline

#### Scenario: Empty states are consistent
- **WHEN** a page has no content to show
- **THEN** it MUST use the shared empty-state primitive
- **AND** MUST state what the page is for and what to do next
