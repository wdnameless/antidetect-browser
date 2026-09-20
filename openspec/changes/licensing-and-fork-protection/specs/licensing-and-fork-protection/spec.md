## ADDED Requirements

### Requirement: The vendor licence key is not recoverable from the repository

The private half of the key that signs Pro licences MUST NOT exist in the repository, in its
history, or in any published artifact. The public half MUST be pinned in exactly one canonical
file that both the Rust shell and the Node backend derive from, so that rotating the key is a
single edit plus a regeneration rather than a hand-copy into two languages.

Verification MUST be performed against the pinned key, so a licence signed by any other key —
including the key committed at `tests/unit/licenseManager.test.ts` — is refused.

#### Scenario: A licence signed by the leaked historical key is refused
- **GIVEN** the private key that was committed in `tests/unit/licenseManager.test.ts`
- **WHEN** it signs a payload `{"plan":"pro"}`
- **THEN** `validateLicenseKey` MUST return `{ok: false, reason: 'INVALID_LICENSE'}`
- **AND** `hasFeature('teams')` and `hasFeature('sync')` MUST both be false

#### Scenario: A licence signed by the new vendor key is accepted
- **GIVEN** the current private key, which is held outside the repository
- **WHEN** it signs a payload `{"plan":"pro","email":"…"}`
- **THEN** `validateLicenseKey` MUST return `{ok: true}` with `plan === 'pro'`
- **AND** `hasFeature('teams')` MUST be true

#### Scenario: A test never needs a committed private key
- **WHEN** the licence test suite runs
- **THEN** any keypair it needs MUST be generated at runtime
- **AND** no private key material MAY appear in any tracked file

#### Scenario: Rotating the key cannot silently ship a broken build
- **GIVEN** `resources/license-public-key.pem` has been replaced
- **WHEN** `src/main/licensing/publicKey.ts` was not regenerated
- **THEN** a test MUST fail, naming the drift
- **AND** the failure MUST NOT be a silent rejection of every valid licence at runtime

### Requirement: Licence verification has a native, deny-only verdict

A packaged build MUST NOT grant Pro on the strength of JavaScript alone. The verdict produced by
the Rust shell MUST be consulted, and every clause of that consultation MUST be able to deny
Pro but never to grant it.

Verification outside a packaged build (standalone service, tests, CI) MUST continue to work on
the existing pure-Ed25519 path, so that the absence of the shell never makes the application
unusable.

#### Scenario: A packaged build requires the native verdict
- **GIVEN** the environment marks the build as packaged
- **WHEN** a valid signature is present but no native verdict file exists
- **THEN** `getLicenseState()` MUST report `plan === 'free'`

#### Scenario: A stale verdict cannot authorise a different licence
- **GIVEN** a verdict file issued for a different licence token
- **WHEN** `getLicenseState()` evaluates the stored token
- **THEN** Pro MUST be denied
- **AND** the mismatch MUST be the token fingerprint, not a timestamp heuristic

#### Scenario: A verdict from another build's key is refused
- **GIVEN** a verdict file whose `key_fp` differs from the pinned key's fingerprint
- **WHEN** `getLicenseState()` evaluates it
- **THEN** Pro MUST be denied

#### Scenario: A missing or corrupt verdict degrades to Free, not to a crash
- **GIVEN** the verdict file is absent, empty, not JSON, or has an unknown schema version
- **WHEN** the application queries licence state
- **THEN** it MUST report `plan === 'free'` with `expired === false`
- **AND** it MUST NOT throw, and profiles and proxies MUST remain fully usable

#### Scenario: The standalone service is unaffected
- **GIVEN** the build is not packaged
- **WHEN** a valid licence is stored
- **THEN** `getLicenseState()` MUST report `plan === 'pro'` without consulting any verdict file

### Requirement: The Rust verifier refuses every malformed or foreign licence

`verify_license` MUST be a pure function of the token: no I/O, no global state, and no panic on
any input whatsoever, including empty and adversarial strings.

#### Scenario: Each rejection reason is distinct
- **WHEN** the token is a non-64-byte signature, a valid signature over a non-JSON payload, a
  valid signature over `{"plan":"free"}`, an expired `exp`, or a signature from a foreign key
- **THEN** each MUST return `valid: false`
- **AND** the `reason` MUST name the actual cause rather than a generic failure

#### Scenario: The verdict fingerprint identifies the deciding key
- **WHEN** any verdict is produced
- **THEN** `key_fp` MUST be the SHA-256 prefix of the exact PEM file bytes
- **AND** it MUST equal the fingerprint the Node side computes for the same file

#### Scenario: Arbitrary input cannot crash the shell
- **WHEN** `verify_license` receives an empty string, a lone dot, or random bytes
- **THEN** it MUST return a verdict
- **AND** it MUST NOT panic or abort the process

### Requirement: The repository states its licence and its fork policy

The repository MUST carry a licence that permits community use while preventing a closed
redistribution, and MUST state explicitly what a fork may and may not reuse. Documents MUST NOT
invent legal facts about the operator — unknown values MUST be marked as placeholders.

#### Scenario: The licence is present and machine-recognisable
- **WHEN** the repository root is inspected
- **THEN** `LICENSE` MUST exist and contain the verbatim AGPL-3.0 text
- **AND** a commercial alternative MUST be described in `LICENSE.COMMERCIAL`

#### Scenario: The fork policy names what is protected
- **WHEN** `TRADEMARK.md` is read
- **THEN** it MUST state that forking the code is permitted
- **AND** it MUST state that the product name, logo assets and bundle identifier require a
  rebrand before redistribution

#### Scenario: A contributor cannot accidentally break dual licensing
- **WHEN** a pull request is opened
- **THEN** a CLA workflow MUST require the contributor's agreement
- **AND** `CLA.md` MUST state the specific rights it grants and why they are needed

#### Scenario: Unknown legal facts are placeholders, not inventions
- **WHEN** any of the legal documents are read
- **THEN** an unknown entity name, address, jurisdiction or price MUST appear as an explicit
  placeholder
- **AND** it MUST NOT appear as a plausible-looking invented value

### Requirement: The leaked key is removed from published history by a rehearsed procedure

The remediation of a committed private key MUST be executable without discovering the procedure
during the operation, and MUST NOT be performed blind on the live repository.

#### Scenario: The procedure was rehearsed before it was prescribed
- **WHEN** the runbook is read
- **THEN** it MUST record a rehearsal against a mirror clone
- **AND** it MUST record that the leak is absent from the rehearsed clone's history

#### Scenario: The consequences of the rewrite are stated where the operator decides
- **WHEN** the operator reads the runbook
- **THEN** it MUST state how many commits and tags the rewrite invalidates
- **AND** it MUST state that existing clones and forks are not updated by the rewrite

#### Scenario: The destructive step is left to the operator
- **WHEN** the automation and subagents finish this change
- **THEN** the live remote MUST NOT have been force-pushed
- **AND** the runbook MUST be the thing the operator executes
