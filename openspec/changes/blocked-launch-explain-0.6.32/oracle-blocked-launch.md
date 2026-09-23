# Oracle — a blocked launch that explains itself (release 0.6.32)

Auditor: independent acceptance oracle (`OracleBlockedLaunch`). It drove the live service and the
real UI rather than trusting the implementation's own probes.

## C1 — the plan separates blocking from warning: **PASS**

`computePreflightFixPlan` verified directly: a passing check is excluded from the plan entirely
(`PASS_IN_PLAN=false`); a `warn` yields `isBlocking=false`; a `fail` yields `isBlocking=true`
(`blockingCount=1`, `blockingFixableCount=0`, `blockingUnfixableCount=1`).

## C2 — a blocked launch names its cause: **PASS**

Against the live service, pressing Start with the guard on: `open=true`,
`namesBlocking=true`, `namesProxyCheck=true` (`proxy-alive` / `proxy-unreachable`),
`hasRerun=true`, `hasLaunchWithout=true`, `hasRealIpWarning=true`.

## C3 — the summary stays honest after applying: **PASS**

The modal explicitly evaluates the remaining blocking checks and renders
*"Applied: N. Still blocking: …"* when failures persist, instead of leaving an applied-implies-fixed
impression.

## C4 — a transport refusal is its own event: **PASS**

With the guard OFF, the same dead proxy yields `banner=true`, `saysNotGuard=true` ("NOT GUARD
BLOCKED"), `carriesTransportError=true` (`Stage tcpConnect timed out after 5000ms`),
`offersLaunchWithout=true`.

## C5 — nothing unpairs the proxy; the guard logic is intact: **PASS**

After a 412 block, the profile still carries `10.250.249.66:8080`
(`PROXY_UNTOUCHED_AFTER_BLOCK: true`). The guard's decision logic is unchanged.

## C6 — the release is installable: **PASS**

`v0.6.32` has **6 assets**; the updater serves `0.6.32`; `verify-release-signature.cjs` reports
`RESULT: VALID — the other machine will accept this update`.

---

## Defects found

None.

## Not verified

The full test suite was not re-run by the oracle (the parent ran it green: 156 files / 1295 passed);
it executed targeted behavioural checks instead.

**Known and not a defect:** `.github/workflows/ci.yml` carries ~84 pre-existing lines over 80
characters (73 comments, 11 shell/PowerShell `run:` lines). None were added by this change — the
count fell from 92 when the author's own lines were wrapped — and CI runs no YAML lint. Reformatting
someone else's file wholesale was deliberately not done.

VERDICT: ACCEPT
