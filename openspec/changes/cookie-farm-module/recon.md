# Recon — Cookie farm (profile warming) module

T3 lane. Declared: `Cookie farm module: Actions button that runs an automated profile-warming
crawl across cookie-rich sites`.

## User request (verbatim)

> «Я хочу добавить модуль фарм куки, оно должно быть реализованно в Actions отдельной кнопкой,
> нужно чтобы это автоматически работало мы ходили по разным сайтам где лучше всего собираются
> куки и таки образом прогревать профиль. Давай реализуем по т3 воркфлоу»

## Wave 0 answers (recorded, not re-litigated)

| Fork | Answer |
| --- | --- |
| Site source | Built-in curated list (~30–50 sites) |
| Cookie consent | Accept consent banners automatically |
| Launch trigger | Row button: auto-start (headless) → warm → close |
| Safety | Public pages only, no login, with limits |
| Reporting | Existing reports table + result panel |

## Inventory — what already exists (measured)

| Component | State | Evidence |
| --- | --- | --- |
| `src/main/scripts/modules/cookieRobot.ts` | **EXISTS, 662 lines** | Bezier mouse (`generateBezierPath`), `simulateHumanScroll`, `simulateHumanMouseMove`, `findSafeInternalLink`, per-domain rate limit, blocklist, session cap, abort keys |
| `src/main/api/routes/cookieRobot.ts` | **EXISTS, 209 lines** | run/start, abort/:runId, stop, reports/:id, reports, schedule |
| Reports persistence | **EXISTS** | `cookie_robot_reports` table via `initCookieRobotDb` |
| Task-group scheduling | **EXISTS** | `scheduleCookieRobotTaskGroup` → `createTaskGroup` |
| UI button in Actions column | **ABSENT** | `Profiles.tsx:1546` header, action cell at 1640–1699 has play/stop/preflight/edit/note/kebab |
| Cookie-rich site list | **ABSENT** | `grep -rniE "warmup|warming|cookieFarm|farm"` → 0 hits |
| Cookie-consent handling | **ABSENT** | `grep -niE "consent|banner|onetrust|didomi|quantcast|gdpr|cmp|agree"` in cookieRobot.ts → **0 hits** |

## Two blocking defects found

**D1 — the module cannot obtain a browser, so it never runs.**
`runCookieRobot()` requires a `customPageSupplier` and throws without one:

```
src/main/scripts/modules/cookieRobot.ts:432-440
  if (customPageSupplier) { ... } else {
    throw new Error('Browser supplier or launcher connection required');
  }
```

`grep -rn "customPageSupplier" src/main` → the only hits are the module's own signature and
this throw. **No caller anywhere passes it.** The route calls `runCookieRobot(config)` bare
(`routes/cookieRobot.ts:60`), and `invokeCookieRobotTask(config)` bare (`:47`) — both paths
therefore throw. The HTTP surface has existed and always failed.

**D2 — consent banners are never handled.** No selector, no text match, no CMP integration
anywhere in the module. Decision D2 from Wave 0 ("accept banners automatically") is what makes
the feature worth anything: most sites set their durable cookies only after consent, so a crawl
that ignores banners collects almost nothing.

## Integration points (frozen facts)

- Profile launch: `src/main/launcher/chromium.ts` → `startProfile(cfg)` returns
  `{ ws: { puppeteer } }`; `stopProfile(id)`. `resolveLaunchConfig(id)` in
  `src/main/profiles/profileManager.ts` now returns `headless` (added in the previous task).
- CDP connect pattern: `puppeteer.connect({ browserWSEndpoint: wsPuppeteer, defaultViewport: null })`.
- API: Express router, `authMiddleware`, envelope `{ code, msg, data }`.
- UI: `src/renderer/src/pages/Profiles.tsx` action cell; `t()` i18n with RU map in `i18n.tsx`.
- Migration helper: `ensureColumn(db, table, column, ddl)` in `src/main/db/schema.ts`.

## Acceptance check (observable)

1. `POST /api/cookie-robot/run` against a real profile returns `code: 0` and a report with
   `pagesVisited > 0` — today it always returns the supplier error.
2. After a run, the profile's cookie jar holds cookies from more than one domain, and the count
   exceeds what a consent-less crawl produces.
3. The Actions column shows the button; clicking it warms the profile and reports the result.
