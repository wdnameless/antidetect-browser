## Purpose

Defines requirements for an empirically collected, multi-platform fingerprint catalog and strict cross-subsystem coherence validation.

## ADDED Requirements

### Requirement: Empirical catalog of coherent device archetypes
The system MUST provide an empirical catalog containing real-world hardware profiles for Windows, macOS (Intel & Apple Silicon), and Linux.

#### Scenario: Catalog archetype retrieval
- **GIVEN** a request to generate a profile for macOS on Apple Silicon
- **WHEN** querying the fingerprint catalog
- **THEN** it MUST return an archetype containing consistent GPU renderer (Apple M-series), display resolutions with Retina DPR, macOS audio stack parameters, and native SF Pro font definitions

### Requirement: Cross-subsystem coherence validation
The system MUST enforce strict coherence validation preventing impossible or conflicting hardware and software combinations.

#### Scenario: Detect OS and GPU mismatch
- **GIVEN** a profile configured with Windows OS but an Apple M2 GPU renderer
- **WHEN** evaluated by the coherence validator
- **THEN** it MUST reject the configuration or flag a critical coherence violation

#### Scenario: Detect Display resolution and DPR mismatch
- **GIVEN** a profile configured as a MacBook Pro with DPR = 1.0
- **WHEN** evaluated by the coherence validator
- **THEN** it MUST flag a coherence warning indicating MacBook screens require high-DPI scaling (DPR >= 2.0)

#### Scenario: Detect Client Hints and User-Agent mismatch
- **GIVEN** a User-Agent specifying Chrome 128 on Windows 11
- **WHEN** Client Hints specify `Sec-CH-UA-Platform` as "macOS" or version list as Chrome 115
- **THEN** the validator MUST flag a fatal coherence failure

### Requirement: Coherence preflight check integration
The profile launch pipeline MUST execute coherence validation prior to starting a browser instance.

#### Scenario: Clean preflight launch
- **GIVEN** a profile generated from a verified catalog archetype
- **WHEN** the browser launch preflight check executes
- **THEN** the coherence check MUST pass with zero critical violations and allow startup without warning modals
