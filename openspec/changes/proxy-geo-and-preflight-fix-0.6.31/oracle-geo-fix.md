# Oracle — GEO visibility and preflight FIX (release 0.6.31)

Auditor: independent acceptance oracle (`OracleGeoFix`). Read-only on source; it drove the live UI
and the live API rather than trusting the implementation's own probes.

## C1 — city is fetched, stored and exposed: **PASS**

`proxies.city` is added through the repository's own helper (`ensureColumn(db,'proxies','city','TEXT')`,
`schema.ts:242`); the lookup URL includes `city` (`proxyManager.ts:53`); `setProxyResult` persists it
(`proxyManager.ts:124-128`).

## C2 — the list route exposes geo: **PASS**

`GET /api/v1/proxy/list` returns `city`, `latitude`, `longitude`, `country`, `timezone`.

## C3 — the background pass is paced and safe to repeat: **PASS**

The three routes exist. Pacing is 1500 ms = **40 req/min**, under the 45/min free-tier ceiling.
Resolved rows are skipped (`WHERE (country IS NULL OR country = '' OR city IS NULL)` plus a
per-row guard), and the pass is async, so it cannot block the UI.

## C4 — the Proxies UI shows geography: **PASS**

The auto-detect control renders, each row shows flag + country + city + timezone, and unresolved
rows read "Not detected yet" / "Detecting…" rather than blank.

## C5 — the Fix control is conditional, verified in BOTH directions: **PASS**

This is the check the earlier verification got wrong, so the oracle tested both:
- a profile with `webrtc-leak-risk` → `fixableCount = 3` → **Fix button shown**;
- a profile whose only faults are `proxy-not-found`, `dns-leak-risk`, `relay-unavailable` →
  `fixableCount = 0` → **Fix button strictly omitted**.

## C6 — the fix plan is correct in substance: **PASS**

`webrtc-leak-risk` → `disable_non_proxied_udp`; `tz-proxy-mismatch` → the proxy timezone;
`lang-mismatch` → the country-derived language. DNS leak, QUIC relay and an unreachable/missing
proxy are mapped to explicit manual reasons. Checks with `status === 'pass'` are strictly ignored.

## C7 — applying fixes re-runs preflight: **PASS**

`applyPreflightFixes` runs, outcomes are stored per item (applied / failed), and `onRecheck` is
awaited so the modal shows the **new** verdict rather than the stale one.

## C8 — the release is installable: **PASS**

The updater endpoint serves `0.6.31`. The asset *listing* reports an empty array — the known CI
race, confirmed rather than assumed — while the installer downloads intact (33 315 368 bytes) and
`verify-release-signature.cjs` reports `RESULT: VALID — the other machine will accept this update`.

---

## Defects found

None.

## Not verified

The full vitest suite was not re-run by the oracle (the parent ran it green: 156 files / 1295
passed); the oracle executed targeted behavioural checks instead, and the instruction to stop the
service first exists precisely to avoid misreading machine starvation as a defect.

VERDICT: ACCEPT
