# Noir Design System — density and shell

Extends `openspec/changes/nulltrace-noir-page-sweep/specs/noir-design-system/spec.md`.
Requirements R01–R14i are traced per scenario.

## ADDED Requirements

### Requirement: A single density scale governs the shell and every table

The system SHALL express spacing, control heights, row height, shell widths and type as
named tokens, so that no component hardcodes a height, gap or font size. A 4px-based
spacing scale SHALL exist, and table rows SHALL use one shared height token.

Traces: R03, R06, R09

#### Scenario: A dense row measures the token, not a literal
- **WHEN** any table page renders a row
- **THEN** the row height equals `var(--row-h)` (52px, within the chosen 48–56px band)
- **AND** the row contains exactly one line of content

#### Scenario: No bespoke pixels in the shell
- **WHEN** the shell or a table page is edited
- **THEN** spacing resolves through `--space-*` tokens
- **AND** no `!important` appears in the stylesheet

### Requirement: Navigation is seven grouped destinations with contextual sub-tabs

The sidebar SHALL show seven top-level items. Destinations that are not top-level SHALL be
reachable as a horizontal sub-tab strip within their parent section. No destination SHALL
be removed or become unreachable.

Traces: R01, R02, R14i

#### Scenario: Every legacy destination is still reachable
- **WHEN** the user navigates the redesigned shell
- **THEN** all 15 destinations that existed before the change can still be opened
- **AND** each opens its original page component, with its capabilities intact

#### Scenario: A section without children renders no tab strip
- **WHEN** a top-level item has no sub-destinations (Proxies)
- **THEN** no empty tab strip is rendered

#### Scenario: Badges survive the regroup
- **WHEN** profiles are running or a cloud sync is active
- **THEN** the corresponding top-level item shows its counter/dot indicator

### Requirement: List rows are single-line and separate by divider, not by box

A row SHALL occupy one line at the shared row height, SHALL separate from its neighbour by
a single bottom divider, and SHALL NOT draw a full-perimeter border. Row actions SHALL be
hidden until hover or keyboard focus, and SHALL remain reachable by keyboard.

Traces: R03, R04, R06

#### Scenario: Secondary metadata collapses onto the primary line
- **WHEN** a profile row renders with proxy, OS and fingerprint present
- **THEN** all of them appear on the same line as the profile name
- **AND** secondary values use the muted text token while the name uses the primary text token

#### Scenario: Actions are hidden but keyboard-reachable
- **WHEN** a row is not hovered or focused
- **THEN** its action buttons are not painted
- **WHEN** the row receives keyboard focus
- **THEN** its action buttons become visible and operable

### Requirement: The interface stays monochrome

The renderer SHALL paint zero chromatic colours in its chrome. Operator-chosen data colours
(profile and tag pickers) are exempt and SHALL be preserved exactly.

Traces: R07, R08, R13i

#### Scenario: Chrome remains greyscale
- **WHEN** any page is rendered
- **THEN** every painted chrome colour has near-equal RGB channels

#### Scenario: Operator colours survive
- **WHEN** a profile carries an operator-selected colour
- **THEN** that value renders unchanged after the redesign

### Requirement: The brand icon is the visor-mask mark, everywhere

The supplied mark — a black visor mask with eye slits — SHALL be the single source of truth
for the brand. Every icon consumer SHALL derive from it: the Windows `.exe`, the tray, the
favicon, the `.ico`/`.icns` bundles, and the sidebar brand mark. A simplified form SHALL be
used where the mark is painted at 16px so the eye slits do not close up.

Traces: R10, R11, R12i

#### Scenario: The packaged executable carries the new mark
- **WHEN** the app is packaged
- **THEN** `resources/icon.png` renders the visor mask and not a shield
- **AND** the generated assets remain mutually consistent at every size

#### Scenario: The tray icon survives downscaling
- **WHEN** the tray icon is rendered at 16–24px
- **THEN** the mark is still recognisable and is not a smudged downscale of the 256px art

#### Scenario: The sidebar brand matches the app icon
- **WHEN** the shell renders
- **THEN** the sidebar brand mark is the same mark as the application icon
