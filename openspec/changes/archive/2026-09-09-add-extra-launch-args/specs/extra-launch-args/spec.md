## Purpose

Defines per-profile extra Chromium launch arguments: append-last override semantics, save-time denylist enforcement, and the profile editor surface.

## ADDED Requirements

### Requirement: User arguments appended last
Profile `launch_args` MUST be appended after every launcher default and stealth flag so Chromium's last-wins behavior lets them override defaults.

#### Scenario: Override ordering
- **GIVEN** launcher defaults containing `--disable-quic` and profile `launch_args: ["--enable-quic"]`
- **WHEN** arguments are composed
- **THEN** the composed argv MUST contain `--enable-quic` after `--disable-quic`

### Requirement: Safety denylist enforced at save
Arguments matching denylisted prefixes MUST be rejected when the profile is saved, and saved profiles MUST never carry denylisted switches at launch.

#### Scenario: Debug port override rejected
- **GIVEN** an update with `launch_args: ["--remote-debugging-port=9222"]`
- **WHEN** validation runs
- **THEN** the save MUST fail naming the denied token and the profile MUST be unchanged