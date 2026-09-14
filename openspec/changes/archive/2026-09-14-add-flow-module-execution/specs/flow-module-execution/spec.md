## Purpose

Defines that a flow's `module` node performs real work, and that no automation surface reports success for an operation it did not perform.

## ADDED Requirements

### Requirement: Module node invokes the referenced module
Compiling a `module` node MUST produce code that invokes the referenced module with the node's arguments and binds the module's result.

#### Scenario: Invocation happens
- **GIVEN** a flow containing a `module` node referencing a stored script
- **WHEN** the flow runs
- **THEN** the stored script MUST actually be invoked with the node's arguments
- **AND** its result MUST be bound to the node's variable when one is set

#### Scenario: No fabricated success
- **WHEN** the compiled program for a `module` node is inspected
- **THEN** it MUST NOT contain a synthesised success result in place of an invocation

### Requirement: Module failure is not success
A module that fails, or a module id that cannot be resolved, MUST fail the node and MUST NOT report success.

#### Scenario: Unresolvable identifier
- **WHEN** a `module` node references an id that resolves to no stored module
- **THEN** the run MUST fail with a typed error naming the identifier

#### Scenario: Module error propagates
- **GIVEN** a stored module that throws
- **WHEN** a flow invokes it
- **THEN** the task MUST be marked as an error, not as finished
- **AND** the module's logs MUST remain retrievable

### Requirement: Module invocation stays inside the sandbox budget
Module invocation MUST NOT give a script authority or resources beyond what the sandbox already grants.

#### Scenario: Call budget applies
- **WHEN** a script invokes modules beyond the configured call ceiling
- **THEN** further invocations MUST be refused, as with any other sandbox HTTP call

### Requirement: Unresolvable modules are caught before execution
A flow referencing a module that does not exist MUST be rejected when it is saved, so the failure is not deferred to run time.

#### Scenario: Save-time rejection
- **WHEN** a flow with a `module` node naming an unknown module is validated
- **THEN** validation MUST report an error naming the module id
