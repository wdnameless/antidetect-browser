# screen-capture-protection Specification

## Purpose
Defines protection of the launcher window against screen capture and unauthorized access during operator idle: display-affinity guard, idle auto-lock, and system lock/suspend engagement.

Implemented in two layers. The backend (`src/main/security/screenProtection.ts`) owns the policy —
the idle threshold, the lock state machine, and the decision of when to engage — and reaches the
platform through three injectable seams. The desktop shell (`src-tauri/src/screen.rs`) supplies
those seams from Rust. Electron is not involved: it was removed with the rest of the desktop runtime.

## Requirements

### Requirement: Launcher window excluded from capture
When capture protection is enabled, the main window MUST be excluded from screen capture and the
setting MUST persist across restarts.

#### Scenario: Toggle engages the guard exactly once
- **GIVEN** protection disabled and the settings toggle switched on
- **WHEN** the change applies
- **THEN** the affinity seam MUST be called with `true` exactly once and the stored setting MUST read back as enabled after restart

#### Scenario: The exclusion is a platform window capability
- **WHEN** exclusion is applied
- **THEN** it MUST be applied through the shell's own window capability (Tauri `set_content_protected`, which is `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Windows and `NSWindowSharingType::None` on macOS)
- **AND** it MUST NOT depend on a desktop-runtime module

### Requirement: Idle auto-lock
When an idle timeout is configured, the app MUST lock after continuous idle reaching the threshold,
hiding windows behind the unlock overlay; timeout `0` MUST disable the idle lock entirely.

#### Scenario: Lock at threshold, not before
- **GIVEN** idle timeout of 15 minutes and a seam reporting idle time
- **WHEN** idle reaches 15 minutes
- **THEN** the lock engages; at 14 minutes it MUST NOT have engaged

#### Scenario: Idle is measured, not assumed
- **GIVEN** an idle timeout greater than zero
- **WHEN** idle time is evaluated
- **THEN** it MUST come from the operating system's last-input time (`GetLastInputInfo` on Windows)
- **AND** it MUST NOT be approximated by a timer started at application launch

### Requirement: System lock and suspend engage the lock
Session-lock and suspend events MUST engage the lock immediately regardless of idle time.

#### Scenario: Suspend locks instantly
- **GIVEN** idle timeout 0 (off) and the suspend event fires
- **THEN** the lock MUST engage anyway

#### Scenario: Session lock engages the lock
- **GIVEN** the operating system session being locked
- **WHEN** the session-lock notification is observed
- **THEN** the lock MUST engage

### Requirement: Platform coverage is stated honestly
Coverage differences MUST be documented rather than implied.

#### Scenario: Windows provides full parity
- **WHEN** the platform is Windows
- **THEN** capture exclusion, measured idle, suspend and session-lock MUST all be implemented (`src-tauri/src/screen.rs`)

#### Scenario: Other platforms are limited
- **WHEN** the platform is not Windows
- **THEN** capture exclusion MUST remain implemented
- **AND** measured idle and session-lock MUST be recorded as an explicit gap in the documentation rather than silently absent
