# Spec — preflight badge and launch guard

## Purpose

Make the profile's preflight verdict visible in the row without re-adding the column the operator
removed, and close the defects the sweep found in the launch guard and the checks behind it.

## Requirements

### Visibility

- The Actions cell MUST render `PreflightBadge`, wired to `inspectPreflight` (open the modal with a
  cached verdict) and `runPreflight` (run a check when none exists).
- The badge MUST show status without a click: idle → `PASS` / `WARN` / `FAIL` / `CHECKING` / `ERR`,
  and MUST show the count of failing or warning checks when that count is non-zero.
- The count MUST come from `checksOf(verdict)`, so a verdict carrying only the `checks` map (no
  `checkList`) still yields a correct count. A badge reading `FAIL` with no count is a defect.
- No Preflight column may be re-added.

### Launch guard correctness

- A profile with a configured proxy that cannot be resolved (row deleted, stale `proxy_id`) MUST
  fail preflight with a distinct reason code, and `blockOnFailLaunchGuard` MUST return
  `allowed: false`. Launching it directly over the host network is the defect this closes.
- A profile with no proxy configured at all MUST continue to pass — that is a legitimate choice.
- "Launch Anyway" MUST be able to override the guard. The override MUST apply only to that explicit
  action; the ordinary Start control MUST remain guarded.

### Check correctness

- `cfg.lang` MUST be read for the profile locale (it is where fingerprints store it), so the
  language check can fire instead of always reporting "not configured".
- The QUIC relay check MUST compare the state STRING returned by `getUdpRelayState`, so a running
  relay can be reported ready.

### Operator guidance

- Every reason code a probe can emit as `fail` or `warn` MUST have a remediation entry. An operator
  who sees a failure MUST get a specific hint, not the generic fallback.
- The map MUST NOT carry entries for codes nothing emits.

### Modal behaviour

- "Re-run Checks" MUST drive the modal it was invoked from through loading → new verdict, and MUST
  surface an error if the run fails. It MUST NOT leave the old verdict on screen.

## Acceptance

- Renderer and main typecheck clean; the preflight unit tests pass, with any test that pinned the
  old fail-open behaviour updated and called out.
- A probe reproduces the guard change: a profile with an unresolvable `proxy_id` yields
  `allowed: false`; a profile with no proxy yields `allowed: true`.
