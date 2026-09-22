## Why

The product ships a cookie-warming robot that has never run. `runCookieRobot()` requires a
`customPageSupplier`, throws `'Browser supplier or launcher connection required'` without one,
and no caller in the repository passes it — so both HTTP entry points (`/api/cookie-robot/run`
and `/api/cookie-robot/start`) fail on every invocation. The module also has no cookie-consent
handling at all, which is the one behaviour that decides whether warming produces a useful
cookie jar: most sites set their durable cookies only after consent, so a crawl that ignores
banners collects almost nothing.

Requested: «Я хочу добавить модуль фарм куки, оно должно быть реализованно в Actions отдельной
кнопкой, нужно чтобы это автоматически работало мы ходили по разным сайтам где лучше всего
собираются куки и таки образом прогревать профиль».

## What Changes

- **The robot resolves its own browser.** `runCookieRobot` keeps its signature but, when no
  supplier is passed, uses a default supplier that connects to the profile: starting it headless
  when idle and stopping it afterwards only if this run started it. This closes the defect that
  made the module unreachable.
- **Cookie-consent handling is added.** A consent finder matches real CMP controls (selector
  first, then text) and clicks them, recording what it clicked per domain.
- **A built-in curated site list replaces the mandatory `urls` parameter.** ~30–50 sites chosen
  because they set durable cookies, sub-selected deterministically from the profile's fingerprint
  seed so two profiles do not warm identically and a re-run warms the same way.
- **The Actions column gets a button.** One click auto-starts the profile headless when needed,
  warms it, and closes it; a profile already running is warmed in place and left running.
- **The result is surfaced.** The existing `cookie_robot_reports` table and report routes are
  reused; a panel shows pages, cookies, domains, errors, and per-domain consent outcomes.
- **Safety limits are enforced as before**: public pages only, no authentication, `maxPages`,
  per-domain rate limit, session cap, blocklist. Challenges are recorded, never bypassed.

## Capabilities

### New Capabilities
- `cookie-farm-warming`: the warm-up run contract — site selection, consent handling, profile
  lifecycle ownership, safety limits, and the observable report.

### Modified Capabilities

None. The existing robot module and report table are reused as-is; this change adds the missing
lifecycle owner, consent behaviour, and the UI entry point.

## Impact

- Affected specs: `cookie-farm-warming` (new).
- Affected code: `src/main/scripts/modules/cookieRobot.ts` (default supplier, consent wiring),
  new `src/main/scripts/modules/cookieFarm/{sites,consent}.ts`,
  `src/main/api/routes/cookieRobot.ts` (optional `urls`, sites route),
  `src/renderer/src/{pages/Profiles.tsx,api.ts,i18n.tsx,icons.tsx,styles.css}`.
- No database migration: `cookie_robot_reports.report_json` absorbs new report fields.
- Non-goals: no login or account creation, no CAPTCHA solving or anti-bot circumvention, no
  proxy rotation, no fingerprint mutation.
