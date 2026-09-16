## MODIFIED Requirements

### Requirement: Launcher window excluded from capture

When capture protection is enabled, the launcher window MUST be excluded from screen capture and the setting MUST persist across restarts.

#### Scenario: Toggle engages the guard exactly once
- **GIVEN** protection disabled and the settings toggle switched on
- **WHEN** the change applies
- **THEN** the exclusion MUST be applied to the window exactly once per change
- **AND** the stored setting MUST read back as enabled after restart

#### Scenario: The exclusion is a platform window capability
- **WHEN** exclusion is applied
- **THEN** it MUST be applied through the platform shell's own window capability
- **AND** it MUST NOT depend on a desktop-runtime module

#### Scenario: On Windows the operating-system affinity is used
- **GIVEN** Windows
- **WHEN** exclusion is applied
- **THEN** the window's display affinity MUST be set to exclude it from capture
- **AND** disabling MUST restore capture affinity

### Requirement: Idle auto-lock

When an idle timeout is configured, the application MUST lock after continuous idle reaching the threshold; the timeout `0` MUST disable the idle lock entirely.

#### Scenario: Lock at threshold, not before
- **GIVEN** an idle timeout of 15 minutes and a measured idle time
- **WHEN** idle reaches 15 minutes
- **THEN** the lock MUST engage
- **AND** at 14 minutes it MUST NOT have engaged

#### Scenario: Idle is measured, not assumed
- **GIVEN** an idle timeout greater than zero
- **WHEN** idle time is evaluated
- **THEN** it MUST be obtained from the operating system's last-input time
- **AND** it MUST NOT be approximated by a timer started at application launch

#### Scenario: Zero disables
- **GIVEN** an idle timeout of `0`
- **WHEN** any amount of idle time elapses
- **THEN** the lock MUST NOT engage from idleness

### Requirement: System lock and suspend engage the lock

The platform's session-lock and suspend events MUST engage the lock immediately regardless of idle time.

#### Scenario: Suspend locks instantly
- **GIVEN** idle timeout `0` (off) and a suspend notification
- **WHEN** the suspend is observed
- **THEN** the lock MUST engage

#### Scenario: Session lock engages the lock
- **GIVEN** the operating system session being locked
- **WHEN** the session-lock notification is observed
- **THEN** the lock MUST engage

#### Scenario: Engagement hides the window
- **WHEN** the lock engages
- **THEN** the shell window MUST be concealed
- **AND** it MUST be restorable by the unlock path

### Requirement: Platform coverage is stated honestly

Coverage differences MUST be documented rather than implied.

#### Scenario: Windows provides full parity
- **WHEN** the platform is Windows
- **THEN** capture exclusion, measured idle, suspend and session-lock MUST all be implemented

#### Scenario: Other platforms are limited
- **WHEN** the platform is not Windows
- **THEN** capture exclusion MUST remain implemented
- **AND** measured idle and session-lock MUST be recorded as an explicit gap in documentation
