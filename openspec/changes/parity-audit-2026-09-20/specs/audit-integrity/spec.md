# Audit — re-verification requirements

Traced to `manifest.md` (R01–R09i). This capability governs audits, not product behaviour:
its scenarios define what makes a delivered audit trustworthy.

## ADDED Requirements

### Requirement: An audit states what changed, not only what is

A re-audit SHALL identify the delta since the prior audit — with dates, counts, and the
structural changes — so that a reader can tell stale findings from current ones.

Traces: R01, R03

#### Scenario: The delta is quantified
- **WHEN** the audit is read
- **THEN** it states how many commits landed since the previous audit and when that audit was
- **AND** it names any structural change that invalidates earlier findings

#### Scenario: A superseded finding is marked as such
- **WHEN** a previous finding no longer holds
- **THEN** the audit says so explicitly rather than repeating it

### Requirement: Competitor comparisons cite a verifiable source

Every competitor capability SHALL be attributed to a source that can be re-checked, and
anything that could not be grounded SHALL be marked inferred rather than asserted.

Traces: R02, R06

#### Scenario: Each claim carries provenance
- **WHEN** a competitor feature is described
- **THEN** the description names the file or URL it came from
- **AND** claims that could not be read are labelled INFERRED

#### Scenario: Both competitors are covered
- **WHEN** the comparison is read
- **THEN** ShardX and Afina are each assessed on the same axes, so gaps are comparable

### Requirement: Bug findings are verified before they are reported

A finding SHALL NOT enter the report until it has been checked against the code, and a
finding that fails verification SHALL be recorded as rejected with the reason.

Traces: R04, R05, R07, R08i

#### Scenario: A serious finding is reproduced, not inferred
- **WHEN** a finding claims data loss or a security gap
- **THEN** it is demonstrated by running the code, and the observed output is quoted
- **AND** severity reflects what was observed, not what was suspected

#### Scenario: A rejected claim is documented
- **WHEN** a plausible finding fails verification
- **THEN** the audit records it as rejected and states what the code actually does
- **AND** it does not appear in the fix queue

#### Scenario: Findings carry a location and a rank
- **WHEN** a finding is reported
- **THEN** it names the file and line that carries the defect
- **AND** findings are ordered by blast radius so the operator knows what to fix first
