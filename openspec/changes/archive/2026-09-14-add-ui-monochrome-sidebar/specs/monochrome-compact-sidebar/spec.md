## Purpose

Defines user interface specifications for the compact monochrome sidebar, including collapsible icon-rail dimensions, tooltip behaviors, micro-badge status indicators, and color theme constraints.

## ADDED Requirements

### Requirement: Collapsible icon-rail navigation
The main navigation sidebar MUST support a collapsed icon-rail state (52px width) and an expanded drawer state (220px width), with smooth CSS width transitions.

#### Scenario: User toggles collapsed rail mode
- **GIVEN** an expanded sidebar displaying navigation icons and text labels
- **WHEN** the user clicks the collapse button or presses `Ctrl+B` / `Cmd+B`
- **THEN** the sidebar width MUST animate to 52px and textual labels MUST be hidden

#### Scenario: User restores expanded drawer mode
- **GIVEN** a collapsed icon-rail sidebar
- **WHEN** the user clicks the expand button
- **THEN** the sidebar width MUST animate back to 220px and textual labels MUST become visible

### Requirement: Collapsed hover tooltip flyouts
When the sidebar is in collapsed rail mode, hovering over any navigation icon MUST immediately display a floating tooltip displaying the item's title and hotkey.

#### Scenario: Tooltip presentation on icon hover
- **GIVEN** the sidebar is collapsed to 52px
- **WHEN** the user hovers over the "Profiles" icon
- **THEN** a tooltip element MUST appear directly to the right of the icon with text "Profiles"
- **AND** MUST dismiss immediately when the mouse leaves the icon boundary

### Requirement: Monochrome visual aesthetic
The sidebar component MUST adhere strictly to the monochrome dark palette (`#0c0c0e` surface, `#09090b` canvas, `rgba(255, 255, 255, 0.08)` active highlight, white `#ffffff` icons).

#### Scenario: Active route visual indicator
- **GIVEN** the user is viewing the "Profiles" page
- **WHEN** the sidebar renders
- **THEN** the "Profiles" navigation button MUST display an active background of `rgba(255, 255, 255, 0.08)` and icon color `#ffffff`
- **AND** inactive items MUST render with icon color `#71717a`

### Requirement: Sidebar collapse preference persistence
The user's chosen sidebar state (collapsed or expanded) MUST be persisted across application restarts.

#### Scenario: Restoring saved sidebar state
- **GIVEN** the user previously collapsed the sidebar to 52px
- **WHEN** the application is restarted
- **THEN** the sidebar MUST initialize directly in the collapsed 52px rail mode without animation flicker
