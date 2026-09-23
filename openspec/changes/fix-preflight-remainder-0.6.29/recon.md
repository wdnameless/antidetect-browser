# Recon — the three remaining preflight findings, release 0.6.29

## Task

> «Все фикси» — everything gets fixed.

Context: the preflight sweep produced nine findings. Six were fixed and released in 0.6.28 (the P0
fail-open guard, plus Launch Anyway, Re-run Checks, the remediation map, `cfg.lang`, and the QUIC
state comparison). Three were reported but deliberately deferred. This change closes them — "все"
means no finding is left standing.

## The three, verified against the source before being acted on

**A — a blocked launch could show a stale PASS (P1).** `Profiles.tsx` `start()` discards the fresh
failing verdict the guard response already carries (`guardRes.data.verdict`) and calls
`inspectPreflight`, which returns the **local cache** first. An operator who ran a preflight earlier
and then changed the proxy sees the modal open with "Overall Result: PASS" and green ticks, while
the page banner says the launch was blocked. Two contradicting statements about one profile — and
the failing one is true.

**B — the proxy is probed twice, concurrently (P1).** `runPreflight` runs `checkProxyAlive` and
`checkEgressIpGeo` inside one `Promise.all`, and both independently call
`proxyManager.checkProxy(...)` with identical arguments. This is not merely wasted work: on a
**rotating** proxy the two calls exit through different IPs, so the egress-geo check compares the
profile's declared country against an IP the liveness check never observed. SSH proxies open two
tunnels on dynamic ports, and public GeoIP lookups are doubled against a 45/min limit.

**C — the primary network probe reports no latency (P3).** `checkProxyAlive` writes
`result.latencyMs` into its human-readable `detail` string only. `CheckVerdict.durationMs` exists
(`types.ts:80`) and `PreflightModal` renders it, so every lesser check shows a latency badge while
the proxy check — the one whose latency actually matters — shows none.

## Acceptance

- A blocked launch opens the modal on the verdict the guard just returned, never a cached PASS.
- One `checkProxy` call per `runPreflight`; `checkProxyAlive` keeps `fail` on an unresolvable proxy
  and `pass` on no proxy without calling it; `checkEgressIpGeo` keeps its distinct `warn` path.
- The proxy verdict carries `durationMs`.
- Both typechecks clean; `tests/unit/preflight` green; full suite green; tagged and published as
  0.6.29 with a signature that verifies against the configured pubkey.

## Outcome

All three fixed, each proven by execution rather than by reading:

- **A** — reproduced in a real browser (warm cache with PASS → break the proxy → launch with the
  guard on) and shown fixed: the modal now reads `✕ FAIL 2` with the guard banner present. The first
  attempt at this fix looked up `data.verdict`, but the blocked response carries the verdict directly
  in `data`, so it silently fell back to the cache and left the defect standing — caught only by
  running the sequence.
- **B** — proven with an instrumented `checkProxy`: exactly **one** call per `runPreflight` with a
  proxy, and **zero** for a proxy-less profile, after the refactor that replaced the mutable binding
  with a const expression.
- **C** — `durationMs: 42` reaches the verdict for the proxy check, so the modal renders its latency.

Full suite 156 files / 1290 passed; both typechecks clean; build and SBOM verification green.
