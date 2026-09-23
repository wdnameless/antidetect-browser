# Recon — proxy GEO and preflight FIX (release 0.6.31)

## Request (verbatim, two screenshots)

> «Так же в прокси должно показываться ГЕО. И проблемы при preflight надо добавить кнопку FIX и
> фиксить их. Как то. давай думать как это реализовать»

Screenshot 1 — the Proxies page: the Location/IP column is empty for most rows and shows only a
country and timezone for a few, and only after that row was tested by hand.
Screenshot 2 — the preflight modal on `door_inseam_2L13`: overall `WARN 3`, with `webrtc-hygiene`,
`dns-egress` and `quic-relay-state` all warning, and only three controls: Close, Re-run Checks,
Launch Profile.

## Measured state (before any change)

| Piece | State | Evidence |
| --- | --- | --- |
| Proxy geo storage | EXISTS | `proxies` has `country`, `timezone`, `latitude`, `longitude` (`proxyManager.ts:32-35`) |
| Geo is populated | PARTIALLY | `checkProxy` queries ip-api.com — but **without `city`** (`proxyManager.ts:51`), and only when a row is checked manually |
| Geo exposed to UI | PARTIALLY | `GET /api/v1/proxy/list` returns `country` and `timezone` only — no city, no coordinates |
| Location column | MISLEADING | renders geo only from a manual `check()` result or the stored country; otherwise "Not tested" |
| Profiles list geo | PARTIAL | selects `px.country AS proxy_country` only |
| Preflight failures | VISIBLE, not actionable | the modal lists checks and remediation text, but offers no way to APPLY anything |

## Which preflight problems a button can actually fix

Determined by reading the endpoints, not by assumption:

- **Fixable** — `webrtc-leak-risk` (set `webrtc_policy = 'disable_non_proxied_udp'`; the endpoint
  accepts exactly that enum, `browser.ts:438`), `tz-proxy-mismatch` (set the profile `timezone` to
  the proxy's declared timezone), `lang-mismatch` (set `fingerprint.config.lang` from the proxy
  country via the `countryToLangMap` that already exists in `preflightService.ts` — the locale lives
  in the fingerprint blob, not on the profile row, so it goes through `profileUpdateFingerprint`).
- **Not fixable by a button, and we say so rather than faking it** — `dns-egress` (an HTTP proxy
  cannot tunnel raw DNS; the real remedies are switching the proxy type to SOCKS5 or accepting the
  leak) and `relay-unavailable` (needs UDP relay infrastructure). `proxy-not-found` and
  `proxy-unreachable` are configuration/environment problems, not profile settings.

## Rate limit that constrains the design

The user's library has **142 proxies**, and ip-api.com's free tier allows **45 requests per
minute**. Filling 142 rows naively would exceed it ~3× and start failing. The background pass is
therefore paced, resumable, skips rows that already have geo, and must never block the UI.

## Acceptance

- Proxies show flag + country + city + timezone, populated automatically — no per-row manual test.
- The geo pass respects the 45/min limit and can be re-run safely.
- The preflight modal offers one Fix action that applies every safely-fixable problem and re-runs
  the checks, showing the new verdict.
- Problems without an automatic fix say so, with the reason.
- Neither feature invents data: unknown geo reads as unknown, and an unfixable check is never
  presented as fixed.
