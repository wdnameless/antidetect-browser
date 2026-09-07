## Purpose

Defines the hidden CDP Motion domain for human-like input synthesis: per-profile motor seeds, Fitts's-law pointer trajectories, per-key typing with a typo model, fail-closed pointer lifecycle, and the requirement that the domain stay invisible to protocol enumeration.

## ADDED Requirements

### Requirement: Motor seed derivation
The Motion subsystem MUST derive a per-profile motor seed deterministically from the profile fingerprint seed using domain-separated derivation, overridable per session.

#### Scenario: Same profile produces identical plans
- **GIVEN** profile seed `123456789` and glide parameters `from(20,20) to(640,360) targetWidth=220`
- **WHEN** planning the glide twice
- **THEN** both plans MUST be byte-identical

#### Scenario: Different profiles never share trajectories
- **GIVEN** two profiles with seeds 1 and 2 created a second apart
- **WHEN** planning identical glides for both
- **THEN** the plans MUST differ in timing and control points

### Requirement: Fitts's-law pointer trajectories
`Motion.glideTo` MUST produce a trajectory whose total duration follows Fitts's law and is monotone in target width: smaller targets take strictly longer.

#### Scenario: Small target takes longer than large target
- **GIVEN** an active pointer and a fixed distance of 800px
- **WHEN** gliding to a `targetWidth` of 16 and separately to 256
- **THEN** the 16px glide MUST report a strictly greater `durationMs` than the 256px glide

#### Scenario: Coordinates are viewport CSS pixels
- **GIVEN** a glide plan to `(640, 360)`
- **WHEN** executing the plan
- **THEN** every synthesized move event MUST use viewport CSS pixel coordinates

### Requirement: Keystroke typing with optional typo model
`Motion.enterText` MUST type text one key at a time through the browser input path with per-key delays derived from the profile's pace, and MUST NOT use clipboard, `insertText`, or `Page.evaluate`.

#### Scenario: Typing reports real-time duration
- **GIVEN** text of 40 characters at default pace
- **WHEN** `Motion.enterText` completes
- **THEN** `durationMs` MUST be at least 40 × the minimum per-key delay

#### Scenario: Typos correct with real backspace
- **GIVEN** `allowTypos: true` and a seed producing a typo
- **WHEN** typing completes
- **THEN** the emitted key sequence MUST contain a wrong character followed by Backspace before the corrected character, and the final field value MUST equal the requested text

### Requirement: Fail-closed pointer lifecycle
A Motion session without an active pointer MUST reject every command other than `Motion.createPointer` with an explicit error instead of inventing an origin.

#### Scenario: Glide without pointer errors
- **GIVEN** a profile with no pointer created
- **WHEN** sending `Motion.glideTo`
- **THEN** the response MUST be an error identifying the missing pointer, and no input events MUST be synthesized

### Requirement: Hidden domain enumeration
The Motion domain MUST NOT appear in `Schema.getDomains`, `/json/protocol`, or any protocol discovery surface.

#### Scenario: Protocol discovery cannot see Motion
- **WHEN** a client calls `Schema.getDomains` or fetches `/json/protocol` on a running profile
- **THEN** the response MUST NOT contain the string `Motion`