# Oracle verdict — blind acceptance

Auditor: `BlindAcceptance` (oracle agent, independent, read-only, briefed against the OPERATOR'S
ORIGINAL RUSSIAN REPORT rather than against our spec).

## Verdict

`STATUS: PASS_WITH_CONCERNS`, `verdict: ACCEPT`, all six gates `true` (R-table, R-transfer,
R-collapse, R-stealth, R-quit, no-regressions).

## The auditor's three concerns, and what checking them found

Its verdict was accepted; its reasoning was **not** taken on trust, because its file references
did not match the tree (`min-width: 1060px` against an actual 1080px; sidebar `200px` against an
actual 240px; `proxy.ts:474-478`; `chromium.ts:840-865`). Each concern was therefore re-checked
directly.

### 1. "A running destination profile is overwritten underneath the live browser process"

**Already fixed before the audit result arrived.** Real defect, found by auditing my own change
and reproduced: the source-wins upsert rewrote every differing column including `status`,
`created_at` and `updated_at`, so importing a folder from a machine where the profile is closed
marked a profile that is open HERE as `closed`. Fixed in `7e20fd6` — the three live columns are
excluded from the update, matching the rule the repository already applies to maintenance
(`rotateFingerprints` skips a running profile with error `'running'`). Test added and proven to
fail on the old behaviour.

### 2. "The pinned column's hover background may not match in the light theme"

**Not a defect — disproved by measurement.** The row-hover treatment is
`rgba(255,255,255,0.025)` over the app ground; the pinned cell's hover is
`color-mix(bg-app 97.5%, white 2.5%)`. Both were composited numerically over `#fafafa` in the
browser's own colour engine: both resolve to `[250, 250, 250]`, delta `[0, 0, 0]`. The pinned
cell is indistinguishable from an ordinary cell on hover.

### 3. "DPAPI falls back to unencrypted plaintext with prefix `dpapi:plain:`"

**The stated mechanism does not exist** — `grep -rn "dpapi:plain" src/` returns nothing. The
underlying observation is worth keeping, though: the persisted stealth key on this machine holds
an `aes:` value, not `enc:`. That is the AES-256-GCM local key file, because `setSecretCipher` is
re-exported but **never called** — the shell exposes `secrets::secret_encrypt`/`secret_decrypt`,
and nothing wires them into the backend, so the DPAPI path is unreachable in this build.

Pre-existing, not introduced by these fixes, and the private key is still never written in
plaintext (`secret.key` sits beside the database). The changelog and the source comment said
"DPAPI-protected", which was wrong; corrected in `8b997c6`, and the gap is now named in the
source so the next reader does not repeat the assumption.

## What the auditor explicitly did not verify

- Live UI rendering inside the running Tauri webview at custom window sizes (it audited CSS/DOM
  and tests instead, to avoid disturbing the operator's instance).
- A physical tray right-click exit on the operator's instance.
- A transfer between two genuinely separate machines.

The first two were covered directly by our own verification: the table was measured in a live
browser at 1400/1100/900/760px with a real click landing on the pinned column's kebab, and the
quit path was exercised live — 12 Chromium processes to 0 in two seconds, with the backend's own
log showing `shutdown: profiles stopped {"reason":"shell-exit","stopped":2,"failed":0}`, which is
the graceful path rather than a job-object kill.
