# Recon — bug sweep + release 0.6.27

## Task

> «Ищи ошибки и выкатывай релиз ччтобы я обновился»

## What was swept

The cookie-farm delivery from the previous session: `src/main/scripts/modules/cookieRobot.ts`,
`src/main/scripts/modules/cookieFarm/{sites,consent}.ts`, `src/main/api/routes/cookieRobot.ts`,
`src/renderer/src/{pages/Profiles.tsx,api.ts,i18n.tsx}`. An adversarial reviewer was dispatched
against the diff with hypotheses on lifecycle, concurrency, abort, session cap, boundary
validation and report integrity; every finding was then verified against the code before being
acted on, and each fix was proven by execution.

## Findings and their evidence

| # | Severity | Where | Verified how |
| --- | --- | --- | --- |
| F1 | P0 | `cookieRobot.ts` supplier | Read: `pages[0]` reused as the crawl page. Proved by probe: operator tab now survives. |
| F2 | P0 | `cookieRobot.ts` supplier | Read: `throw` before `close()` is returned → caller `finally` has nothing to call. |
| F3 | P1 | `consent.ts` poll | Read: loop only checked the deadline, not the kill switch. |
| F4 | P1 | `cookieRobot.ts` | Read: `report.managedProfile = true` unconditional on that path. |
| F5 | P2 | `cookieRobot.ts` | Read: `urls.length === 0 && (urls === undefined \|\| null)`; `positiveOr` absent. Live probe. |
| F6 | P2 | `cookieRobot.ts` finally | Read: two keys set, one deleted. Live probe: `stopped=false` after completion. |
| F7 | P2 | `Profiles.tsx` modal | Read: close handler sets `isOpen:false` while `busy` stays true. |
| F8 | latent | `securePreferences.ts` | Measured: bare `whoami` **fails** on this host, absolute path returns the real SID. |
| F9 | release risk | `mcpBundle.test.ts` | Measured: one bundle build ~6.7s alone, 22.5s under load vs the 20s default. |

## Release state, measured before touching anything

- All three version files sat at `0.6.26`; tag `v0.6.26` was already consumed, so the release needs `0.6.27`.
- `docs/RELEASE.md` describes the updater as broken ("пароль не соответствует ключу"). **That is stale.**
  Measured instead of trusted: `latest.json` is published, the local key matches
  `plugins.updater.pubkey` in `tauri.conf.json`, and
  `node scripts/verify-release-signature.cjs` on the published 0.6.26 installer reports
  `RESULT: VALID — the other machine will accept this update`.
- The signing chain therefore works end to end, and a `0.6.27` tag should produce a working update.

## Acceptance

`verify-cookie-farm.mjs` (10 checks), `verify-boundary-guards.mjs` (4), `verify-no-tab-hijack.mjs`
(4), `verify-consent-differential.mjs` (R14), full vitest suite, both typechecks, and the published
signature check — all against a real running service and the real Chromium kernel.
