## Why

The current desktop UI layout uses a wide 240px sidebar with high-contrast borders and full textual labels. For power users managing dozens of browser profiles simultaneously, screen real estate is at a premium. A compact monochrome sidebar (48px–56px icon rail with high-density mode, tooltip flyouts, status badges, and collapsible state) maximizes the active canvas area while upholding the minimalist dark aesthetic.

## What Changes

- Compact icon-rail navigation: 52px width default with optional expand toggle to 220px.
- Tooltip hover flyouts for collapsed navigation items.
- High-density status indicators (profile running count, sync state dot, proxy health indicator) integrated into icon badges.
- Fully unified monochrome palette (`#09090b` app background, `#0c0c0e` sidebar, subtle 1px border `rgba(255, 255, 255, 0.08)`).
- Persistent sidebar collapse preference stored in user settings.

## Capabilities

### New Capabilities
- `monochrome-compact-sidebar`: Collapsible icon-rail navigation, tooltip popovers, density modes, and monochrome visual styling.

### Modified Capabilities
None.

## Impact

- `src/renderer/src/App.tsx`: Sidebar navigation structure and collapse toggle state.
- `src/renderer/src/styles.css`: CSS classes for `.sidebar-compact`, `.nav-icon-rail`, and `.sidebar-tooltip`.
