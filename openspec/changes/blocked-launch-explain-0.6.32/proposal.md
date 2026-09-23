# A blocked launch that explains itself

## Why

Reported: «Нажимаю запустить профиль, но браузер не запускаетя, так же есть такие ошибки. И фикс не
работает.»

Both halves were reproduced against a live service, and neither is a bug in the guard.

The launcher is fine: a profile with no proxy starts cleanly. The profile in the screenshots carries
a dead proxy (`10.250.249.66:8080`), so the launch is refused twice over — by the guard with HTTP 412
when it is on, and by the transport when it is off. Both refusals are correct.

What is wrong is everything around them:

- **`Fix` repairs the wrong thing and does not say so.** The plan's only auto-fix on that profile is
  the WebRTC policy. Applying it succeeds, preflight re-runs, and the launch is still refused —
  because the blocker was `proxy-alive`. The operator presses Fix, is told it worked, and cannot
  start the profile. "Фикс не работает" is a fair reading of that.
- **A blocked launch never says why.** The UI surfaces a generic message instead of the verdict it
  was handed, so the blocking check is never named. And a guard refusal ("I stopped you") is
  presented identically to a transport refusal ("the proxy refused the connection").

## What Changes

- **The plan distinguishes blocking from warning.** A check that is refusing the launch is marked as
  blocking and shown apart from warnings that merely deserve attention, so it is obvious that the
  auto-fixable item is not the obstacle.
- **The post-fix summary stays honest.** If a blocking check remains after the fixes run, the modal
  says so instead of leaving a green "applied" impression.
- **A blocked launch explains itself** — naming the check and its reason, and offering *Проверить
  снова* plus *Запустить без прокси*, the latter warning plainly that the profile would go out on
  the real IP.
- **The two refusal kinds are visually distinct**, so the operator knows whether they were stopped by
  a policy they can re-check or by a proxy that is not answering.

## Capabilities

### Modified Capabilities
- `preflight-remediation` — the fix plan gains a blocking/warning distinction and an honest summary.
- `profile-preflight-check` — a refusal now reports its cause rather than a generic block message.

## Impact

- Renderer only: `components/PreflightModal.tsx`, `preflight.ts`, `pages/Profiles.tsx`, `i18n.tsx`.
- No server change: the blocked response already carries the full verdict, verified in the route.
- No change to the guard's decision logic and no automatic unpairing of a proxy. Sending a profile
  out on the real IP is the one outcome this product exists to prevent; the operator may choose it,
  never by default.
