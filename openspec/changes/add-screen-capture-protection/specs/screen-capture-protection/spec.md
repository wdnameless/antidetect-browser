## Purpose

Defines protection of the launcher window against screen capture and unauthorized access during operator idle: display-affinity guard, idle auto-lock, and system lock/suspend engagement.

## ADDED Requirements

### Requirement: Launcher window excluded from capture
When capture protection is enabled, the main window MUST be excluded from screen capture (Electron `setContentProtection(true)`) and the setting MUST persist across restarts.

#### Scenario: Toggle engages the guard exactly once
- **GIVEN** protection disabled and the settings toggle switched on
- **WHEN** the change applies
- **THEN** the affinity seam MUST be called with `true` exactly once and the stored setting MUST read back as enabled after restart

### Requirement: Idle auto-lock
When an idle timeout is configured, the app MUST lock after continuous idle reaching the threshold, hiding windows behind the unlock overlay; timeout `0` MUST disable the idle lock entirely.

#### Scenario: Lock at threshold, not before
- **GIVEN** idle timeout of 15 minutes and a seam reporting idle time
- **WHEN** idle reaches 15 minutes
- **THEN** the lock engages; at 14 minutes it MUST NOT have engaged

### Requirement: System lock and suspend engage the lock
`powerMonitor` `lock-screen` and `suspend` events MUST engage the lock immediately regardless of idle time.

#### Scenario: Suspend locks instantly
- **GIVEN** idle timeout 0 (off) and the suspend event fires
- **THEN** the lock MUST engage anyway