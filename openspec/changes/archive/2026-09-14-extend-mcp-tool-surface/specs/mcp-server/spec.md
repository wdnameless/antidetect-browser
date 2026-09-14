## ADDED Requirements

### Requirement: Tool classification is total
Every registered tool MUST belong to exactly one tier, so no tool is reachable without passing an authorization check.

#### Scenario: No unclassified tool
- **WHEN** the registry is inspected
- **THEN** every registered tool name MUST appear in the default set or the gated set
- **AND** no name MUST appear in both

#### Scenario: Listing reflects the caller's rights
- **WHEN** a standard-scope caller lists tools
- **THEN** the listing MUST NOT present gated tools as callable

### Requirement: Destructive and secret-touching tools stay gated
A tool that deletes durable data, reveals a stored secret, or mutates credentials MUST require the existing elevated scope and MUST be refused otherwise.

#### Scenario: Standard scope refused
- **GIVEN** a caller with standard scope
- **WHEN** it invokes a destructive tool
- **THEN** the call MUST be refused and the refusal MUST be recorded

#### Scenario: Elevated scope allowed
- **GIVEN** a caller holding the required scope
- **WHEN** it invokes the same tool
- **THEN** the call MUST proceed

### Requirement: Prohibited operations stay prohibited
Adding tools MUST NOT introduce raw CDP execution, arbitrary process execution, arbitrary filesystem manipulation, or unbounded script evaluation.

#### Scenario: Prohibited set unchanged
- **WHEN** the registry is inspected
- **THEN** no new tool MUST fall into the prohibited categories
- **AND** the existing prohibited names MUST remain prohibited

### Requirement: New surface is documented
The documented tool list MUST match the registry, including each tool's tier.

#### Scenario: Documentation matches registry
- **WHEN** the documented tool list is compared with the registry
- **THEN** every registered tool MUST be documented with its correct tier
