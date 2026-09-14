# Design: Monochrome Compact Sidebar

## Context and Scope

The user interface requires a high-density, compact sidebar layout adhering to modern anti-detect and multi-session browser workflows. The component should maximize table and profile grid screen real estate while remaining clear and responsive.

## Key Decisions

1. **Dual-State Layout (Collapsed Rail vs Expanded Drawer)**: Default collapsed state uses a 52px width rail. Clicking the expand button or pressing `Ctrl/Cmd+B` toggles the full 220px drawer with smooth transitions.
2. **Instant Tooltip System**: In collapsed state, hovering over any navigation icon renders a zero-delay floating tooltip positioned to the right of the rail.
3. **Monochrome Dark Theme Tokens**:
   - Rail background: `#0c0c0e` (neutral pitch black).
   - Active item background: `rgba(255, 255, 255, 0.08)` with white `#ffffff` icon.
   - Inactive item: `#71717a` text/icon, hover to `#e4e4e7` and `rgba(255, 255, 255, 0.04)`.
   - Subtle vertical divider: `1px solid rgba(255, 255, 255, 0.07)`.
4. **Embedded Micro-Badges**: Running profiles counter rendered as a subtle pill badge (`bg-white/10 text-xs text-white/90`).
5. **State Persistence**: Current expanded/collapsed state persisted in `localStorage` key `ui.sidebar_collapsed`.

## Migration and Compatibility

- Pure CSS and React component refactor of the existing nav block in `App.tsx`.
- Existing route identifiers (`profiles`, `proxies`, `groups`, `settings`) remain unchanged.
