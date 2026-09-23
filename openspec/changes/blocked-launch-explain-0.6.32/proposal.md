# A blocked launch that explains itself

## Why

Reported: «Нажимаю запустить профиль, но браузер не запускаетя, так же есть такие ошибки. И фикс не
работает.»

Both halves were reproduced against a live service, and neither is a flaw in the guard.

The launcher works — a profile with no proxy starts cleanly. The reported profile carries a dead proxy
(`10.250.249.66:8080`), so the launch is refused twice over: by the guard with HTTP 412 when it is on,
and by the transport when it is off. Both refusals are correct.

What is wrong is everything around them. `Fix` repaired the WebRTC policy while the actual blocker was
`proxy-alive`, reported success, and left the launch refused — so "фикс не работает" was accurate. And
a blocked launch showed a generic message instead of the verdict it was handed, so the blocking check
was never named, with a guard refusal indistinguishable from a transport refusal.

## What Changes

- The plan marks checks that **block** a launch apart from warnings, and says plainly that the
  auto-fix will not unblock while a blocker remains.
- The post-fix summary names a remaining blocker rather than implying success.
- A blocked launch names the check and its reason and offers *Проверить снова* and *Запустить без
  прокси*, the latter warning that traffic would use the real IP.
- The two refusal kinds are visually distinct.

## Capabilities

### Modified Capabilities
- `preflight-remediation` — the plan gains a blocking/warning distinction and an honest summary.
- `profile-preflight-check` — a refusal reports its cause rather than a generic block message.

## Impact

- Renderer only: `preflight.ts`, `components/PreflightModal.tsx`, `pages/Profiles.tsx`, `i18n.tsx`.
- No server change; no change to the guard's decisions; no automatic proxy unpairing.
