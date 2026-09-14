## Purpose

Defines access to the existing global key store from a no-code flow, without duplicating the store or changing its storage.

## ADDED Requirements

### Requirement: A flow can read a global key
A flow node MUST be able to read the value of a key from the existing global key store.

#### Scenario: Read a stored key
- **GIVEN** a key with a stored value
- **WHEN** a flow node reads it
- **THEN** the node MUST receive that value in the run

#### Scenario: Missing key is reported
- **WHEN** a flow node reads a key that does not exist
- **THEN** the run MUST report the missing key
- **AND** MUST NOT silently substitute an empty value

### Requirement: A flow can write a global key
A flow node MUST be able to set a key, and the write MUST persist with the same semantics the script engine already provides.

#### Scenario: Write persists
- **GIVEN** a flow that sets a key
- **WHEN** the run completes
- **THEN** the key's stored value MUST be the written value
- **AND** MUST be readable by a later script or flow

#### Scenario: Storage is unchanged
- **WHEN** the change is inspected
- **THEN** the existing key storage and encryption path MUST be the one used

### Requirement: Local variables and global keys are distinguishable
An author MUST be able to tell whether a binding refers to a flow-local variable or a global key, and the two MUST NOT collide.

#### Scenario: Distinct bindings
- **GIVEN** a flow with a local variable and a global key of the same name
- **WHEN** a node references each
- **THEN** the two references MUST resolve to their own value
- **AND** the author MUST be able to see which is which
