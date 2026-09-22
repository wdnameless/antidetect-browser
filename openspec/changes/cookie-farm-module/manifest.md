# Manifest — cookie-farm-module

Requirement rows are the contract. Each `R##` quotes the user verbatim where the requirement
came from them, and cites the measured evidence where it came from the codebase.

## User requirements (verbatim)

- **R01** — «Я хочу добавить модуль фарм куки» → *a cookie-farming module exists and works.*
- **R02** — «оно должно быть реализованно в Actions отдельной кнопкой» → *a dedicated button in
  the Actions column of the profile row.*
- **R03** — «нужно чтобы это автоматически работало» → *one click runs the whole warm-up with no
  further operator steps.*
- **R04** — «мы ходили по разным сайтам где лучше всего собираются куки» → *the crawl visits
  sites chosen because they actually set useful cookies, from a built-in curated list.*
- **R05** — «таки образом прогревать профиль» → *the outcome is a warmed profile: a cookie jar
  that looks like a used browser, not a fresh install.*

## Wave 0 decisions (user-selected)

- **R06** — Site source: built-in curated list of ~30–50 sites, sub-selected per profile by
  fingerprint seed so two profiles do not warm identically.
- **R07** — Cookie consent: accept consent banners automatically. This is the value driver —
  most sites only set durable cookies after consent.
- **R08** — Launch trigger: the row button auto-starts the profile headless when it is not
  running, warms it, then closes it. A profile already running is warmed in place and left
  running.
- **R09** — Safety: public pages only, never authenticate, and honour `maxPages`, per-domain
  rate limit, session cap, and blocklist.
- **R10** — Reporting: reuse `cookie_robot_reports` and surface a result panel to the operator.

## Measured defects this change must close

- **R11** — `runCookieRobot()` must run when no `customPageSupplier` is passed. Every caller
  today omits it, so the module throws `'Browser supplier or launcher connection required'` on
  every invocation (`cookieRobot.ts:432-440`; no caller passes it — verified by repo-wide grep).
- **R12** — Consent banners must be handled. The module currently contains zero consent logic
  (grep for `consent|banner|onetrust|didomi|quantcast|gdpr|cmp|agree` → 0 hits), so R07 is
  unmet by the existing code.

## Acceptance criteria

- **R13** — `POST /api/cookie-robot/run` on a real profile returns `code: 0` with
  `pagesVisited > 0`; before this change the same call returns the supplier error.
- **R14** — A completed warm-up leaves cookies from more than one domain in the profile, and the
  count is strictly greater than the same crawl with consent handling disabled.
- **R15** — The Actions column renders the button, and a run started from it produces a visible
  result (pages, cookies, domains, errors).

## Explicit non-goals

- **R16** — No login, no form submission, no account creation on any site.
- **R17** — No CAPTCHA solving and no anti-bot circumvention; a challenge is recorded and the
  page is abandoned.
- **R18** — No proxy rotation logic and no fingerprint changes; warming uses the profile's own
  identity exactly as configured.
