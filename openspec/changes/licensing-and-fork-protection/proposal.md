# licensing-and-fork-protection

Put an enforceable licence on a public repository, and make the Pro tier mean something again.

## Why

Two facts, both measured rather than assumed.

**1. The repository has no licence at all.** No `LICENSE`, no `COPYING`, no `TRADEMARK`,
no `CLA` (`git ls-files` finds none). Under default copyright the code is "all rights reserved",
but nothing states it, and two of the three committing identities are inconsistent
(`Graber Developer <good22067@gmail.com>` = 141 commits, `wdnameless <good22067@gmail.com>` = 90,
plus a noreply alias) — so nobody reading the repository learns what they may do with it.

**2. The vendor licence key is compromised, and the Pro tier is decorative.** The private half of
the Ed25519 key that signs Pro licences is committed at `tests/unit/licenseManager.test.ts`
(commit `70e8bb7`). Its public half is pinned in the shipped build. Executed proof:

```
bodies_identical                                             : true
FUNCTIONAL_PROOF_test_key_signs_licenses_the_shipped_app_accepts : true
```

Any clone can therefore mint unlimited working Pro licences. The file's own comment —
«must be rotated before public release» — records that this was known and deferred.

There are 0 forks today. Relicensing moves first-mover advantage to us only while that is true:
a licence change binds future commits, never code someone already took (GNU GPL FAQ,
`https://www.gnu.org/licenses/gpl-faq.html#CanDeveloperRevokeLicense`).

## What changes

### Legal surface (R01, R03, R07)

| File | Purpose |
|---|---|
| `LICENSE` | AGPL-3.0 — the community edition's terms |
| `LICENSE.COMMERCIAL` | Commercial licence for those who cannot meet AGPL's source-disclosure terms |
| `TRADEMARK.md` | Code may be forked; the name, logo and branding may not be reused without rebranding |
| `CLA.md` + CI workflow | Contributors grant the rights needed to keep dual licensing possible |

AGPL-3.0 was chosen over BUSL-1.1 because the operator wants the code to stay genuinely open
while a closed SaaS built on it is the thing that must not happen. AGPL's network clause is
exactly that instrument, and it needs no Change Date. Trade-off accepted: AGPL is a one-way
door for anyone who has already forked — which is why it lands now, at zero forks.

### Key rotation (R13i) — the load-bearing change

- A new vendor keypair is generated; the **private** half lives outside the repository forever.
- The public half is pinned in one place: `resources/license-public-key.pem`.
- `src/main/licensing/publicKey.ts` and `src-tauri/src/license.rs` both read that single source,
  so a fork must patch two languages rather than one string.
- `tests/unit/licenseManager.test.ts` stops carrying a private key: it generates a throwaway
  pair at runtime. A committed private key becomes impossible, not merely discouraged.

### Native verification (R10)

`src-tauri/src/license.rs` verifies licences in Rust (`ed25519-dalek`, already a dependency) and
is registered as a Tauri command.

**What this buys, stated honestly:** the private key is absent (rotation), and the verdict exists
in native code, so a JavaScript-only patch no longer suffices — an attacker must also patch the
binary. **What it does not buy:** a determined attacker with the binary can still patch the Rust
side. For a client-side application there is no design that prevents this; the honest goal is
raising the cost from a two-minute text edit to a reverse-engineering task. The architecture has
no Node↔Rust IPC — the sidecar is spawned with environment variables only
(`src-tauri/src/sidecar.rs:225-268`) — so the verdict crosses to the backend as a file in the
settings directory, and it may only ever **deny**. Elevating to Pro still requires a valid
signature, which requires the private key, which is no longer on the internet.

### History rewrite (R11)

`git filter-repo` is not installed on this machine, and the leak spans **202 commits across 24 of
54 tags**. A rehearsed runbook (`docs/GIT_HISTORY_REWRITE.md`) is delivered; **the force-push is
left to the operator**, because it invalidates every existing clone and 24 published tags. A
subagent must not make that call.

## Non-goals

- No licensing/activation server, no heartbeat, no device limits (R09: signature only).
- No payment integration (R10; R12 records Telegram Stars/crypto for the later wave).
- No change to the Free/Pro boundary (R08 keeps it exactly as today).
- No attempt to make the client unbeatable — documented above rather than pretended.

## Acceptance

1. Secrets sweep over tracked files: zero `-----BEGIN … PRIVATE KEY-----` hits.
2. A licence signed by the old leaked key is **refused**; one signed by the new key is **accepted**.
3. Rust unit tests refuse tampered, expired, foreign-signed and malformed licences.
4. `npm test` and `cargo test` green, with no reduction in test count.
5. `LICENSE`, `TRADEMARK.md`, `CLA.md` exist and are referenced from `README.md`.
6. The runbook reproduced on a mirror clone: leak absent from the clone's rewritten history.
