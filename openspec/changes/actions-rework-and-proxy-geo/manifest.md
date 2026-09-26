# Requirements manifest — proxy geo, and the cookie farm behind it

Verbatim operator statements are quoted; each requirement names the evidence that proves it.

## R01 — A profile created with a proxy must be checked without the operator asking

> «почему гео не отображается proxy not checked yet, если профиль создается с прокси то он сразу
> должен чекаться, запоминаться и показывать флаг страны и две буквы страны по типу DE, US, FR»

Three verbs in that sentence, and each was a separate defect:

- **«сразу должен чекаться»** — a queue must run the lookup on its own. Evidence: a profile bound to
  a resolved proxy produced `{code:"DE", country:"Germany"}`; a proxy that could not be reached was
  recorded `status='fail'` with `country_code` NULL — no invented country.
- **«запоминаться»** — the result must persist to the `proxies` row, not live in a modal. Evidence:
  `proxies.country_code` written and read back after the worker ran.
- **«показывать флаг страны и две буквы страны по типу DE, US, FR»** — the cell must render flag and
  code. Evidence: `geoLabel` produced `🇩🇪 DE · Germany`, `🇺🇸 US · United States · New York`,
  `🇫🇷 FR · France`. A country *name* is refused rather than rendered as a broken glyph.

Also required by the same sentence — the doors that were not the Proxies page. The operator reaches
the database through the SDKs, agents, batch create, imports and the saved-proxy picker, and none of
them ran a check. Evidence: `queueGeoChecks` is reached from `createProfile` (inline proxy and
`saved by id`) and from the update path.

## R02 — A failed proxy must show a failure, not a missing value

> «И если он неудачный, то гела не отображается, отображается ошибка крестик»

Evidence: `Profiles.tsx` renders `✕` with `data-testid="proxy-failed"` when `proxy_status === 'fail'`,
a geo label when one resolved, and "Not checked yet" only when neither is true — so an unchecked proxy
is distinguishable from a failed one.

## R03 — The cookie farm must actually collect cookies, and report how many

Stated as the purpose of the wider work; the failure was measurable rather than qualitative.

- **Consent must be dismissed on real banners.** Measured against eleven realistic labels, exact
  matching clicked four — "Accept all cookies and continue", "I accept the use of cookies" and the
  German, Russian and French long forms all fell through. After the fix: 16 realistic labels clicked,
  17 dangerous ones ("Reject all", "Accept only necessary", "Manage settings", and their equivalents
  in five languages) all refused.
- **The reported count must describe the run.** `cookiesSet` came from `page.cookies()`, scoped to one
  origin, with each page closed after its visit. Measured on four real sites: 11 reported where the
  session held 63. An end-to-end run of eleven domains reported **0**; the same run after the fix
  reported **164**, equal to the browser's own jar.
- **The site pool must be large enough for the pages requested, and honest about what it holds.** A
  run requests up to `maxPages` (default 20). 31 sites were added, each measured; 3 were dropped for
  Cloudflare interstitials, 4 for setting no cookies, 2 after re-measuring (one intermittent
  challenge, one permanently unusable because its own hostname matched the challenge keyword).

## R04 — The report must show where the run's traffic exited

> «нормальная гео в модалке» / the flag shown in the report header

Evidence: `exitGeo` is resolved **when the report is created** and stored on it, because a report
describes a past run — re-checking or replacing the proxy afterwards must not re-label it. Verified:
with a resolved proxy the report carried `{code:"DE", country:"Germany"}`; with no proxy it carried
`null` rather than a guess.

## Explicitly NOT in scope

Nothing in the operator's statements asks for the geo to be re-derived in the renderer, for a
fallback flag when the country is unknown, or for the farm to visit a fixed site list. Each of those
was avoided deliberately: a wrong flag is worse than a missing one, and a fixed list does not age.
