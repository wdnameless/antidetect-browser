## Purpose

Defines a coherent synthetic identity per profile and its insertion into a page through the real input path.

## ADDED Requirements

### Requirement: A profile has one stable person
Persona values MUST be derived deterministically from the profile, so the same profile always presents the same person.

#### Scenario: Stable across runs
- **GIVEN** a profile
- **WHEN** its persona is generated twice, in separate processes
- **THEN** every field MUST be identical

#### Scenario: Distinct across profiles
- **GIVEN** two profiles filling the same form
- **WHEN** each generates a persona
- **THEN** their values MUST differ
- **AND** they MUST NOT share a name, address, email, phone or card

### Requirement: The person is internally coherent
The generated fields MUST agree with one another, because an incoherent identity is itself a detection signal.

#### Scenario: Email derives from the name
- **WHEN** a persona is generated
- **THEN** its email local part MUST relate to its name

#### Scenario: Address fields agree
- **WHEN** a persona is generated
- **THEN** its postcode and region MUST be valid for its country
- **AND** its phone number MUST match that country's national format

#### Scenario: Payment card is well-formed
- **WHEN** a persona is generated
- **THEN** its card number MUST satisfy the Luhn check
- **AND** its expiry MUST be in the future

#### Scenario: Date of birth is plausible
- **WHEN** a persona is generated
- **THEN** its date of birth MUST yield an adult age

### Requirement: Filling uses the real input path
Persona values MUST reach the page as input events produced by the browser's own input handling, not by direct value assignment.

#### Scenario: Real keystrokes
- **WHEN** a persona fills a text field
- **THEN** the page MUST receive keystroke input events
- **AND** the implementation MUST NOT assign the field's value directly

#### Scenario: A script can observe a human-filled field
- **GIVEN** a form whose field counts `keydown` events
- **WHEN** the persona fills it
- **THEN** the field MUST have observed keyboard input

### Requirement: Unmapped fields are reported
A fill operation MUST NOT silently skip a requested field.

#### Scenario: A field with no mapping
- **WHEN** a fill is requested for a field the persona cannot supply
- **THEN** the result MUST report that field as unfilled rather than reporting overall success
