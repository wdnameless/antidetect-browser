# Recon — a blocked launch that explains itself, and a Fix that does not mislead

## Report (verbatim, three screenshots)

> «Нажимаю запустить профиль, но браузер не запускаетя, так же есть такие ошибки. И фикс не работает»

Screenshots: Preflight Guard **ON**; profile `MAIN X` with proxy `10.250.249.66:8080`; the preflight
modal showing `Fix (1)` with `proxy-alive` **FAIL** (`connect ETIMEDOUT 10.250.249.66:8080`) and
`egress-ip-geo` / `webrtc-hygiene` / `dns-egress` / `quic-relay-state` warning.

## Reproduced against a live service — and the diagnosis is not "a bug in the guard"

**The launcher itself is fine.** A profile with no proxy starts cleanly:
`GET /api/v1/browser/start` → `code: 0`, a CDP endpoint is returned, stop succeeds. So "браузер не
запускается" is a consequence of the proxy, not a broken launcher.

**With the guard on**, the profile with `10.250.249.66:8080` is refused exactly as designed:

```
POST /api/profiles/<id>/start-with-preflight {blockOnFail:true}
→ HTTP 412   msg: 'Launch blocked by preflight failure'
             data: <the full verdict>
   proxy-alive   fail   proxy-unreachable
```

**Without the guard**, the same profile fails differently:

```
GET /api/v1/browser/start → code: -1
   msg: 'Proxy transport probe failed at stage tcpConnect: Stage tcpConnect timed out after 5000ms'
```

Both were reproduced. The proxy is genuinely dead; both refusals are correct.

## The two real defects

**1. `Fix` fixes something other than what blocks the launch, and says nothing about it.**
The plan on this profile contains exactly one auto-fix — `webrtc-leak-risk →
webrtc_policy = 'disable_non_proxied_udp'`. Applied against the live service:

```
POST /api/v1/browser-profile/update { webrtc_policy: 'disable_non_proxied_udp' } → code: 0
POST /api/profiles/<id>/preflight → overall: fail   (proxy-alive: proxy-unreachable)
POST /api/profiles/<id>/start-with-preflight     → HTTP 412, still blocked
```

So the button works, reports success, and the launch is still refused. To an operator that is
precisely "фикс не работает" — and the modal never distinguishes the warning it repaired from the
failure that blocked them.

**2. A blocked launch never says why, and the two refusal kinds look alike.**
The UI surfaces the generic `'Launch blocked by preflight failure'` rather than the verdict it was
handed, so the operator is not told which check blocked the launch or what to do about it. And a
guard refusal versus a transport refusal — "I stopped you" versus "the proxy refused the connection"
— are presented as the same kind of event.

## Wave 0 decisions (user-selected)

- **Explain the cause and offer a choice**: name the blocking check and its reason, and offer
  *Проверить снова* and *Запустить без прокси*, the latter warning explicitly that the profile would
  leave on the real IP.
- **Separate guard-blocked from transport-refused** in the UI, with different wording and actions.

## Acceptance

- The modal shows which check blocks the launch, distinct from warnings that merely need attention.
- Fixing the warning must not read as having fixed the block; a remaining blocker is stated plainly.
- A guard refusal names the check and offers re-check and a warned direct launch.
- A transport refusal reads as the proxy refusing, not as the guard blocking, with the same escape.
