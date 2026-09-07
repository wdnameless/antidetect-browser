# Design: Task Calendar

## Key Decisions

1. **Pure projection, no server change**: cron expressions are projected client-side (`cronProjection.ts`: `nextOccurrences(expr, from, until)`). Zero main-process risk; the page is a view over existing data.
2. **Standard 5-field cron** only — the exact dialect already accepted by `triggers.ts`; nonstandard expressions render a disabled marker with a tooltip instead of throwing.
3. **Month grid, month-at-a-time**: cells list up to 3 markers + "+N more"; markers show group name and time. Next-occurrence today is highlighted.
4. **Monochrome styling**: follows the v0.2.21 design system (white primary, gray outlines); group differentiation via shades, not hues.

## Testing Strategy

- `tests/unit/cronProjection.test.ts`: daily/weekly/step cron projections, month boundary crossing, invalid expression → empty result (never throws), DST-agnostic local-time projection matching trigger scheduler semantics.
- Component check via existing UI test approach; Playwright visual pass per repo Visual QA standards (`document.fonts.ready` + 300ms debounce) on the Calendar page with seeded fixtures.