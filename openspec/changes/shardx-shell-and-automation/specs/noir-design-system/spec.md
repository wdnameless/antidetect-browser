# Shell and Automation — requirements

Extends the `noir-design-system` capability. Traced to
`openspec/changes/shardx-shell-and-automation/manifest.md` (R01–R13i).

## ADDED Requirements

### Requirement: Typography is the real, self-hosted brand face

The shell SHALL render in Inter, loaded from woff2 files vendored in the repository. It
SHALL NOT request a font from a network origin at runtime, and it SHALL cover both Latin and
Cyrillic, because the interface ships Russian strings.

Traces: R01, R02

#### Scenario: Inter is the painted typeface
- **WHEN** any screen renders
- **THEN** the computed `font-family` of the body resolves to Inter
- **AND** the browser reports the Inter face as loaded

#### Scenario: No network font request
- **WHEN** the built output is inspected
- **THEN** no font URL points at an external origin
- **AND** the packaged app renders correctly with no network access

#### Scenario: Cyrillic text stays in the same face
- **WHEN** a Russian string renders
- **THEN** it is drawn in Inter, not a fallback face

#### Scenario: ALL-CAPS micro-labels are spaced
- **WHEN** an uppercase section label renders
- **THEN** it carries non-zero letter-spacing from the tracking token

### Requirement: The sidebar footer exposes MCP, the Automation API, docs and the version

The footer SHALL provide a collapsible MCP panel, a collapsible Automation API panel, a
Documentation control, and a version indicator. The MCP panel SHALL reflect the real server
state and offer start/stop plus a copyable client configuration.

Traces: R03, R04, R05, R06, R10i, R11i

#### Scenario: MCP status reflects the process, not the intent
- **WHEN** the MCP server is running
- **THEN** the panel reports running and shows the live endpoint
- **WHEN** the server process is killed directly
- **THEN** the panel reports not running

#### Scenario: The copied configuration actually works
- **WHEN** the user copies the MCP client config while the server runs
- **THEN** the endpoint in that config answers a JSON-RPC request
- **AND** the stdio variant names a path that exists

#### Scenario: Unknown counts are not invented
- **WHEN** the status endpoint cannot be reached
- **THEN** the tool count displays as unknown rather than a hardcoded number

#### Scenario: The update indicator does not overclaim
- **WHEN** no update check has run
- **THEN** the footer says it was not checked rather than that the app is up to date

#### Scenario: The API key is not printed in full
- **WHEN** the Automation API panel displays an example command
- **THEN** the key is masked on screen
- **AND** copying still yields the working command

### Requirement: The Automation tab responds to available width

The Automation workspace SHALL adapt its three panels to the window width. Below the narrow
breakpoint the inspector SHALL become an overlay drawer and the node palette SHALL collapse
to a rail that remains legible. No horizontal page scrollbar SHALL appear at desktop widths.

Traces: R08, R09

#### Scenario: Wide window shows all three panels
- **WHEN** the window is at or above the mid breakpoint
- **THEN** palette, canvas and inspector are all visible

#### Scenario: Narrow window collapses to a rail and a drawer
- **WHEN** the window is below the narrow breakpoint
- **THEN** the palette is a rail with readable labels
- **AND** the inspector is reachable as an overlay drawer

#### Scenario: The drawer is keyboard-correct
- **WHEN** the drawer is open and the user presses Escape
- **THEN** it closes and focus returns to the trigger

#### Scenario: No horizontal overflow
- **WHEN** the Automation tab is measured at 1000px and at 1600px
- **THEN** the document scroll width does not exceed the client width

### Requirement: Prior accepted shell behaviour is preserved

The regrouped navigation, the monochrome palette and the absence of `!important` SHALL
survive this change.

Traces: R12i, R13i

#### Scenario: Navigation stays complete
- **WHEN** the shell renders
- **THEN** seven top-level destinations are shown
- **AND** every page remains reachable through a destination or its sub-tabs

#### Scenario: The palette stays monochrome
- **WHEN** any page renders
- **THEN** the number of chromatic chrome colours is zero

#### Scenario: No important flags
- **WHEN** the stylesheet is inspected
- **THEN** it contains zero `!important` declarations
