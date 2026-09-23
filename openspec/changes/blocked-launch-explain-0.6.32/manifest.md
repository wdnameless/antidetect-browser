# Manifest — a blocked launch that explains itself (release 0.6.32)

## User report (verbatim)

> «Нажимаю запустить профиль, но браузер не запускаетя, так же есть такие ошибки. И фикс не работает»

- **R01** — «браузер не запускаетя» → *the operator cannot start the profile and is not told why.*
- **R02** — «И фикс не работает» → *pressing Fix does not resolve the situation that blocks them.*

## What was measured, and what it means

- **R03** — The launcher is NOT broken. A proxy-less profile starts cleanly (`code: 0`, CDP endpoint
  returned, stop succeeds). The failure is a consequence of the dead proxy
  (`10.250.249.66:8080`), reproduced both with the guard (HTTP 412) and without it
  (`tcpConnect timed out after 5000ms`).
- **R04** — `Fix (1)` repairs `webrtc-leak-risk` and does **not** touch `proxy-alive`, which is what
  blocks the launch. Measured: the update returns `code: 0`, preflight is re-run, `overall` is still
  `fail` on `proxy-unreachable`, and the launch is still refused with 412. The button reports success
  while nothing the operator cares about changed — which is exactly "фикс не работает".
- **R05** — A blocked launch shows the generic `'Launch blocked by preflight failure'` rather than
  the verdict it is handed, so the blocking check is never named.

## Wave 0 decisions (user-selected)

- **R06** — Explain the cause and offer a choice: name the blocking check with its reason, and offer
  *Проверить снова* and *Запустить без прокси*, the latter warning explicitly that the profile would
  leave on the real IP.
- **R07** — Separate guard-blocked from transport-refused in the UI, with different wording and
  actions.

## Acceptance criteria

- **R08** — The modal distinguishes the check that **blocks launch** (status `fail`) from warnings
  that merely deserve attention, so the operator can see that the auto-fixable item is not the
  blocker.
- **R09** — After applying fixes, a still-blocking check is stated plainly; the summary must not
  read as though the block was resolved.
- **R10** — A guard refusal names the blocking check and its reason, and offers both *Проверить
  снова* and *Запустить без прокси* with the real-IP warning.
- **R11** — A transport refusal is visibly a different event from a guard block, carries the
  concrete transport error, and offers the same escape.

## Non-goals

- **R12** — No change to the guard's decision logic or to the preflight detection: both refusals are
  correct and must stay.
- **R13** — No automatic unpairing of the proxy. Silently sending a profile out on the real IP is the
  single outcome an antidetect browser exists to prevent; the operator may choose it deliberately,
  never by default.
