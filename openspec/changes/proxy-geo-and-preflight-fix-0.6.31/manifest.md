# Manifest — proxy GEO and preflight FIX (release 0.6.31)

## User requirements (verbatim)

> «Так же в прокси должно показываться ГЕО. И проблемы при preflight надо добавить кнопку FIX и
> фиксить их. Как то. давай думать как это реализовать»

- **R01** — «в прокси должно показываться ГЕО» → *the proxy list shows where each proxy actually
  exits, so the operator can see it at a glance.*
- **R02** — «надо добавить кнопку FIX и фиксить их» → *a failing preflight is actionable from the
  modal, not merely described.*
- **R03** — «Как то. давай думать как это реализовать» → *the design is the deliverable's concern,
  not just the button.*

## Wave 0 decisions (user-selected)

- **R04** — GEO shows **flag + country + city + timezone**, and is populated **automatically in the
  background**; the operator must not have to test 142 rows by hand.
- **R05** — FIX is **one action that applies everything safely fixable and immediately re-runs
  preflight**, showing the new verdict. Partial success must be visible per fix.
- **R06** — Checks that cannot be fixed by a button report **why**, and nothing is changed
  automatically for DNS. No DoH flags are added.

## Measured constraints

- **R07** — The proxy table already stores `country`, `timezone`, `latitude`, `longitude`, but
  `city` is **not fetched** (`proxyManager.ts:51` omits it) and geo is only written when a row is
  checked manually.
- **R08** — `GET /api/v1/proxy/list` exposes only `country` and `timezone`.
- **R09** — ip-api.com's free tier allows **45 requests/minute**, and the library holds **142
  proxies** — so an unpaced fill would exceed the limit roughly threefold. The pass must be paced,
  resumable, skip already-resolved rows, and never block the UI.
- **R10** — Fixability, established by reading the endpoints: `webrtc-leak-risk`,
  `tz-proxy-mismatch` and `lang-mismatch` are safely fixable via existing routes;
  `dns-leak-risk`, `relay-unavailable`, `proxy-not-found` and `proxy-unreachable` are not, and must
  be reported as such.

## Acceptance criteria

- **R11** — Each proxy row shows flag, country, city and timezone once resolved, and an honest
  "not detected yet" state before that — never a blank that could read as "no geo".
- **R12** — Geo fills without operator action, respects the rate limit, and re-running it is safe.
- **R13** — The preflight modal shows a Fix action only when something is fixable; pressing it
  applies the fixes, re-runs the checks, and the modal shows the NEW verdict rather than the old one.
- **R14** — Every unfixable warning states the concrete reason; no check is ever displayed as fixed
  when it was not.

## Non-goals

- **R15** — No new npm dependencies (the flag comes from the ISO code, computed in-app).
- **R16** — No automatic DNS or QUIC remediation.
- **R17** — No change to the preflight detection logic itself — only to what can be done about what
  it reports.
