## MODIFIED Requirements

### Requirement: Automated warm-up sessions
The system SHALL provide a Cookie Robot that browses a supplied URL list within a profile using human-like pacing (randomized dwell, scrolling, mouse movement), accumulating cookies, history and localStorage through the profile's own proxy and fingerprint. The reported `cookiesSet` SHALL describe the cookies the browsing SESSION holds, not the cookies visible to a single page origin, because each page is closed after its visit and the operator reads this number as the outcome of the run.

#### Scenario: Warm-up run
- **WHEN** the robot runs with 20 URLs on a profile
- **THEN** the profile accumulates cookies/history from visited domains and a run report records pagesVisited, cookiesSet and durationMs

#### Scenario: Pacing bounds
- **WHEN** dwell range is 2000-8000 ms
- **THEN** every per-page dwell in the run log falls within the configured range

#### Scenario: Counted cookies describe the session, not one origin
- **WHEN** a run visits several domains and the browser session holds more cookies than the final page's own origin
- **THEN** `cookiesSet` equals the session total, so it includes cookies set by previously visited domains
- **AND WHEN** no browser handle is reachable, the count falls back to the page's own jar rather than reporting zero

### Requirement: Consent dismissal on real banners
The robot SHALL dismiss a consent banner by matching its control text against consent verbs, and SHALL treat a control as an accept action when its normalized text either equals a known verb or BEGINS with one followed by a word boundary. It MUST refuse any control whose text contains a refusal, settings or customisation fragment, because such controls appear beside the accept action on the common banner and clicking one records a refusal the operator did not choose.

#### Scenario: A banner phrasing the action as a sentence
- **WHEN** a banner offers a control reading "Accept all cookies and continue" or its equivalent in a supported language
- **THEN** the control is treated as an accept action and clicked

#### Scenario: Refusal and settings controls are left alone
- **WHEN** a page offers "Reject all", "Accept only necessary", "Manage settings" or their equivalents
- **THEN** none of them is clicked, even though "Accept only necessary" contains a consent verb

#### Scenario: The in-page matcher agrees with the Node matcher
- **WHEN** the same label is evaluated by the exported Node matcher and by the function serialized into the browser
- **THEN** both reach the same accept-or-refuse decision

### Requirement: Warm-up site pool
The robot SHALL select warm-up sites from a pool that is at least as large as the largest page count a run can request, that contains no URL twice, and that contains no site whose own URL or title would be matched by the robot's own challenge detector.

#### Scenario: A full-size run is satisfiable
- **WHEN** a run requests the default maximum of 20 sites
- **THEN** 20 distinct sites are returned, drawn from at least five categories

#### Scenario: A site that could never be visited is not listed
- **WHEN** a site's URL contains a challenge keyword such as "cloudflare"
- **THEN** that site is excluded, because the challenge detector would skip it on every visit while logging it as an error

### Requirement: Exit geography on a run report
A run report SHALL record where the profile's traffic exited, resolved when the report is created and stored on the report, so that re-checking or replacing the proxy afterwards cannot re-label a past run. The value SHALL be absent rather than guessed when the profile has no proxy or its country is unresolved.

#### Scenario: A resolved proxy is recorded on the report
- **WHEN** a run executes on a profile whose proxy carries an ISO country code
- **THEN** the report carries that code and country, and the interface renders the flag beside the two-letter code

#### Scenario: No proxy, nothing claimed
- **WHEN** a run executes on a profile with no proxy
- **THEN** the report's exit geography is null and no country is displayed

#### Scenario: A malformed code is not rendered as a country
- **WHEN** a stored value is a country name rather than a two-letter code
- **THEN** no flag is derived from it and the name is shown without a flag, rather than as a broken glyph

### Requirement: Proxy geography is resolved without an explicit request
The system SHALL queue a background geography lookup whenever a proxy is bound to a profile through ANY entry point that writes the binding, including profile creation with an inline proxy, profile creation or update with a saved proxy identifier, imports and batch creation. The lookup MUST be idempotent and MUST NOT re-check a proxy whose row already carries its country code. A lookup that cannot reach the provider SHALL record a failure and SHALL NOT store a country.

#### Scenario: Creating a profile with a proxy
- **WHEN** a profile is created with an inline proxy or a saved proxy identifier
- **THEN** a lookup is queued for that proxy and its country code appears on the profile row without the operator pressing anything

#### Scenario: One request per proxy
- **WHEN** the same proxy is queued again while a lookup is pending or already resolved
- **THEN** no second lookup is spent on it

#### Scenario: An unreachable proxy is recorded as failed, not located
- **WHEN** the provider cannot be reached through the proxy
- **THEN** the row is marked failed with no country code, and the interface shows a failure mark rather than a location or a pending label
