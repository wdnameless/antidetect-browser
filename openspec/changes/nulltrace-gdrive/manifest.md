# Requirements manifest — nulltrace-gdrive

Every row traces to the user's own words. Silence never cancels a row.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R80 | Google Drive sync is in scope | «google sync» (Tier D selection, 2026-09-13) | in-spec |
| R81 | Auth uses a user-supplied OAuth client, not ours | «Пользовательский OAuth client» | in-spec |
| R82 | Profiles, scripts and settings survive a round trip through the operator's Drive | follows from R80 and the program goal «Profiles and settings MUST be synchronizable through the operator's own Google Drive account» | in-spec |
| R83 | No OAuth client, secret or refresh token is ever embedded or logged | follows from R81; embedding one would contradict the decision | in-spec |
| R84i | Drive sync is opt-in and off by default | the operator configures a client id before anything uploads | in-spec |
| R85i | An existing self-hosted sync path keeps working | the product already ships a sync-server and teams; Drive is additive | in-spec |
