## Purpose

Defines the product being reachable as a web application from any operating system, with no install and no code signing, without disturbing the existing desktop build.

## ADDED Requirements

### Requirement: The interface is served over HTTP
The built interface MUST be served by the product's own HTTP server so it can be opened in a browser on any operating system.

#### Scenario: Browser opens the interface
- **GIVEN** the service running on its default loopback address
- **WHEN** a browser on the same machine requests the root path
- **THEN** the application shell MUST be served
- **AND** its assets MUST load without authentication, because the shell must render before a login can occur

#### Scenario: Client-side routes survive a reload
- **WHEN** the browser loads a path that is not a file on disk
- **THEN** the shell MUST be served so the client-side route can take over

#### Scenario: The desktop build is unaffected
- **WHEN** the product is launched as the desktop application
- **THEN** the interface MUST load exactly as before

### Requirement: A served page calls its own origin
When the interface is served from the same origin as the API, it MUST address that origin rather than a hardcoded host and port.

#### Scenario: Non-default port
- **GIVEN** the API listening on a port other than the historical default
- **WHEN** the served interface makes a call
- **THEN** the call MUST target the page's own origin
- **AND** MUST NOT be sent to a hardcoded address

#### Scenario: Explicit override still wins
- **WHEN** an operator has configured an explicit API base
- **THEN** that value MUST continue to be used

### Requirement: Access is authenticated before it is useful
Serving the shell MUST NOT expose any capability. Every data or action endpoint MUST remain behind the existing authentication.

#### Scenario: Unauthenticated data request is refused
- **GIVEN** a browser that has not authenticated
- **WHEN** it requests any data or action endpoint
- **THEN** the request MUST be refused

#### Scenario: Login grants access
- **WHEN** the operator completes the existing panel login
- **THEN** subsequent requests MUST be authorised and the interface MUST become usable

#### Scenario: First run sets a credential
- **GIVEN** an installation with no panel credential
- **WHEN** the interface is opened
- **THEN** it MUST offer one-time credential setup, not an open door

### Requirement: Remote access is opt-in and explicit
Loopback-only remains the default. Reaching the interface from another device MUST require explicit configuration.

#### Scenario: Loopback by default
- **GIVEN** default configuration
- **WHEN** a request arrives with a non-loopback host
- **THEN** it MUST be rejected

#### Scenario: Explicitly configured remote access works
- **WHEN** the operator has configured remote access and the trusted hosts
- **THEN** a request from a trusted host MUST be served
