## Why

Afina exposes a task calendar (visual schedule over automation triggers). Our task groups have cron triggers (`triggers.ts`) with no calendar view — schedules are edited as raw cron strings, giving no overview of when fleets run.

## What Changes

- New page `Calendar` in the renderer: month grid rendering every task-group cron trigger as scheduled run markers (next-occurrence projection, per-group color from the monochrome palette).
- Reads existing trigger data (`GET /api/v1/triggers` + task group list); clicking a marker opens the group detail drawer (existing pattern).
- Nav entry "Calendar" in the sidebar (monochrome icon set, rail + expanded labels per `add-ui-monochrome-sidebar` conventions); i18n keys (RU/EN) per existing `i18n.tsx` pattern.
- Cron projection logic (cron → next N occurrences within month) implemented in `src/renderer/src/cronProjection.ts` with unit tests; no server changes.

## Capabilities

### New Capabilities
- `task-calendar`: month-grid projection of cron triggers, marker interactions, navigation integration.

## Impact

- `src/renderer/src/pages/Calendar.tsx` (new), `src/renderer/src/cronProjection.ts` (new), `src/renderer/src/App.tsx` (route + nav; owned by the integration owner), `src/renderer/src/i18n.tsx` (keys), `tests/unit/cronProjection.test.ts`.
- Read-only feature: no mutations to triggers from the calendar in this slice (editing stays in task groups).