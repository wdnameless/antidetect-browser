## Purpose

Defines per-profile visual identity: stored profile color, badge generation, and launch-time window identification, without altering existing profile behavior.

## ADDED Requirements

### Requirement: Profile color storage and validation
The profile record MUST accept an optional color (3- or 6-digit hex) and MUST reject invalid values; existing profiles without colors MUST behave exactly as before.

#### Scenario: Invalid color rejected
- **GIVEN** a create request with `color: "notahex"`
- **WHEN** validation runs
- **THEN** the request MUST fail with an input error and no profile MUST be created

### Requirement: Badge application at launch
When a profile with a color launches, its window MUST be identifiable via the title prefix derived from the color's badge and the generated badge icon MUST be cached per profile.

#### Scenario: Launched window carries identity
- **GIVEN** profile `kz-01` with color `#2FCB80`
- **WHEN** the profile starts
- **THEN** the window title MUST begin with the badge prefix and `data/profiles/<id>/badge.ico` MUST exist