# Design: Profile Window Badge

## Key Decisions

1. **Honest Windows mechanism**: raw Chromium profile windows are not Electron-owned, so no `setOverlayIcon` on them. The badge surfaces via: (a) window title prefix `[<color-name/initials>] <profile>` set through the existing title hook at launch, (b) a generated per-profile `.ico` (color + initials) used for Windows pinned shortcuts (`.lnk`) pointing at that profile's launch command, (c) the launcher's own taskbar overlay shows the count of running profiles with badge colors in the tray tooltip.
2. **Badge generation**: canvas render at 32×32 and 16×16, initials from profile name (first two alnum chars), PNG→ICO wrap in renderer, cached under `data/profiles/<id>/badge.ico` via the API (not in the profile's Chromium user-data-dir to avoid Chromium scanning it).
3. **Color is data, not style**: stored hex on the profile row; table dot and editor picker use it; monochrome UI palette stays intact (the badge color is the user's choice, not a theme change).
4. **Backward compatible**: nullable column; existing profiles render no prefix until a color is set — zero behavior change for old rows.

## Testing Strategy

- `tests/unit/profileBadge.test.ts`: initials derivation (unicode, empty names), color normalization (3/6-digit hex, invalid → default gray), title prefix formatting, badge cache path mapping, endpoint accept/reject of `color`.
- Component check: editor picker + dot column render (existing UI test approach).