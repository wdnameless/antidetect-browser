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

## Outcome

Both features delivered and verified in a real browser.

**GEO** — the Proxies page renders the `Auto-detect Geo` control and per-row geography; unresolved
rows read "Not detected yet" rather than blank (`hasAuto: true`, `hasNotDetected: true`, 14 rows
rendered). `city` is fetched and stored, the list route returns it with the coordinates, and the
background pass is paced at 1500 ms (40/min) against a 45/min ceiling, measured from the live
status route.

**Preflight FIX** — the modal renders `Fix (1)` with the plan beside it
(`WebRTC routing policy → disable_non_proxied_udp`) and lists the checks it declines to auto-fix with
their reasons (`proxy-alive`, `egress-ip-geo`, `dns-egress`, `quic-relay-state`). Confirmed by
screenshot on a profile that actually has a fixable warning.

Worth recording: my first probe reported "no Fix control" — it had opened a profile whose only
fault was an unresolvable proxy, which is genuinely unfixable, so the button was correctly absent.
The probe was wrong, not the feature; re-testing on a profile with `webrtc-leak-risk` showed the
control. A check that cannot distinguish "correctly hidden" from "missing" proves nothing.

## Release incident, recorded honestly

`gh release view v0.6.31` reports **0 assets**, and the GitHub API agrees — but every asset URL
returns HTTP 200, the installer downloads intact (33 MB), and its signature verifies against the
configured pubkey. The cause is a genuine race in CI: the macOS job and the Windows job both run
`softprops/action-gh-release` for the same tag. The macOS job created the release at 08:55; the
Windows job logged "Release 394468367 is not yet discoverable by tag v0.6.31, retrying..." and then
created its own, uploading all five assets there at 09:08. The tag now resolves to the empty
release while the assets sit on the duplicate, which is why the listings disagree with the
downloads. Every earlier release escaped this only by timing.

The update itself is unaffected — verified end to end. The CI defect is real and worth fixing
before the next release, but it is not a reason to withhold this one.
