## Purpose

Defines the month-grid task calendar: client-side cron projection, marker rendering, and navigation, without any server-side mutation surface.

## ADDED Requirements

### Requirement: Cron projection fidelity
The calendar MUST project standard 5-field cron expressions to their occurrences within a displayed month and MUST NOT throw on nonstandard expressions.

#### Scenario: Weekly trigger appears on correct days
- **GIVEN** a trigger with cron `0 9 * * 1-5` (weekdays 09:00)
- **WHEN** rendering a month
- **THEN** every weekday cell of that month MUST show a run marker at 09:00 and weekend cells MUST NOT

#### Scenario: Invalid expression degrades to a hint
- **GIVEN** a trigger whose cron string is nonstandard or malformed
- **WHEN** rendering the calendar
- **THEN** the trigger MUST render as a disabled marker on its group with a tooltip and MUST NOT break the page or other markers

### Requirement: Calendar is read-only
The calendar MUST NOT mutate triggers or task groups; all interactions navigate to existing editors.

#### Scenario: Marker click opens group detail
- **WHEN** a run marker is clicked
- **THEN** the group detail drawer opens with that group selected and no state is written