# cookie-farm-warming — delta spec

## ADDED Requirements

### Requirement: The robot resolves its own browser

`runCookieRobot` SHALL obtain a page without a caller-supplied `customPageSupplier`. When none
is passed, it SHALL resolve the profile's own browser through a default supplier. The run SHALL
NOT fail with a supplier error on any code path reachable from the HTTP API.

#### Scenario: Run without an explicit supplier
- **WHEN** `POST /api/cookie-robot/run` is called with a valid `profileId` and no supplier
- **THEN** the run starts, and the response is `code: 0` with a report whose `pagesVisited` is
  greater than zero

#### Scenario: Profile not running
- **WHEN** the targeted profile is not running
- **THEN** the supplier starts it headless, and stops it after the run

#### Scenario: Profile already running
- **WHEN** the targeted profile is already running
- **THEN** the run uses that browser and leaves the profile running afterwards

### Requirement: Cookie-consent banners are accepted

The crawl SHALL look for a cookie-consent control on each visited page and click it, trying
known CMP selectors first and falling back to matching the control's visible text. A page
without a consent control SHALL NOT be treated as an error.

#### Scenario: Consent control present
- **WHEN** a visited page shows a consent banner
- **THEN** the control is clicked and the outcome is recorded for that domain

#### Scenario: No consent control
- **WHEN** a visited page shows no consent control
- **THEN** the run continues normally and records no consent click for that domain

#### Scenario: Consent click fails
- **WHEN** the matched control cannot be clicked because it detached or is covered
- **THEN** the failure is recorded in the report's errors and the crawl continues

### Requirement: Warming uses a built-in curated site list

The module SHALL provide a built-in list of sites selected for setting durable cookies. The list
SHALL be used when the caller supplies no `urls`. Selection for one profile SHALL be a pure
function of the profile's fingerprint seed and a count, so that a repeated run warms the same
way and two distinct seeds warm differently.

#### Scenario: No urls supplied
- **WHEN** a run is started without `urls`
- **THEN** the built-in list is used and sites are chosen deterministically from the profile seed

#### Scenario: urls supplied
- **WHEN** a run is started with an explicit `urls` list
- **THEN** that list is used and the built-in list is ignored

#### Scenario: Determinism
- **WHEN** the same seed and count are selected twice
- **THEN** both selections are identical

### Requirement: Safety limits are enforced

A warm-up run SHALL visit public pages only, SHALL NOT authenticate or submit credentials, and
SHALL honour `maxPages`, the per-domain rate limit, the session cap, and the blocklist. A
challenge page SHALL be recorded and abandoned, never bypassed or solved.

#### Scenario: Session cap reached
- **WHEN** the elapsed run time reaches the session cap
- **THEN** the run stops visiting further pages and reports the cap as the reason

#### Scenario: Challenge encountered
- **WHEN** a page presents a CAPTCHA or anti-bot challenge
- **THEN** the page is recorded in the report and no attempt is made to solve or bypass it

#### Scenario: Blocklisted domain
- **WHEN** a candidate URL's host matches the blocklist
- **THEN** that URL is skipped without being visited

### Requirement: The Actions column exposes the warm-up

The profile row's Actions column SHALL provide a control that starts a warm-up for that profile.
The operator SHALL see the outcome — pages visited, cookies collected, domains touched, and
errors — without reading a log file.

#### Scenario: Operator clicks the control
- **WHEN** the operator activates the warm-up control on a profile row
- **THEN** the run starts and the profile's state is reflected while it runs

#### Scenario: Run completes
- **WHEN** the run finishes
- **THEN** the operator is shown pages visited, cookies collected, domains touched, and any errors
