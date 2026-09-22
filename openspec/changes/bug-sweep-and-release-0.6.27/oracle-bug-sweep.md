# Oracle — blind verification of the bug sweep and release v0.6.27

Auditor: independent acceptance oracle (`OracleRelease`). Read-only on source; it downloaded the
published artefacts itself rather than trusting the repo's harnesses.

## C1 — Release exists and is published: **PASS**

`gh release view v0.6.27` →

```
title: v0.6.27   tag: v0.6.27   draft: false   prerelease: false
published: 2026-09-22T14:49:56Z
assets: latest.json, NullTrace-0.6.27-macos-arm64.zip,
        NullTrace-0.6.27-portable-win-x64.exe, NullTrace-0.6.27-portable-win-x64.exe.sig,
        NullTrace_0.6.27_x64-setup.exe, NullTrace_0.6.27_x64-setup.exe.sig
```

## C2 — Updater endpoint and Ed25519 signature verification: **PASS**

The endpoint `.../releases/latest/download/latest.json` serves `"version": "0.6.27"`.

`node scripts/verify-release-signature.cjs .stealth-bench/oracle-release/NullTrace_0.6.27_x64-setup.exe ...sig src-tauri/tauri.conf.json` →

```
public key alg: "Ed" key id 7FDDA4EFF823F429
signature alg : "ED" key id 7FDDA4EFF823F429
signed message: BLAKE2b-512 digest of the artefact
RESULT: VALID — the other machine will accept this update   (exit 0)
```

The portable exe verified identically. This is the check the installed app performs on the user's
machine, so the update will install.

## C3 — Version consistency: **PASS**

`package.json:3`, `src-tauri/tauri.conf.json:4`, `src-tauri/Cargo.toml:3`,
`src-tauri/Cargo.lock:2468` are all `0.6.27`; tag `v0.6.27` → `a81750c8b1048d7aee811ec994ae1b665aaffa26`.

## C4 — CI green on the tag: **PASS**

Run `35739387079`:

```
✓ test                            5m6s
✓ SDK Test (ubuntu-latest)        46s
✓ SDK Test (windows-latest)       23m23s
✓ Release macOS portable          8m6s
✓ Release Tauri Desktop Shell     21m10s
```

The `test` job is the gate the release job waits on, so a flake there would have published nothing.

## C5 — The claimed fixes are real code: **PASS**

| Claim | Evidence |
| --- | --- |
| Dedicated tab, never `pages[0]` | `cookieRobot.ts:442` `await browser.newPage()` |
| Profile stopped if it throws after starting | `cookieRobot.ts:473-475` `stopProfile` in the catch |
| Ownership reported, not assumed | `cookieRobot.ts:467` `ownsProfile: startedHere`; `:564` `report.managedProfile = supplied.ownsProfile` |
| Empty list / non-finite numbers cannot yield a zero-page run | `cookieRobot.ts:520-540` `positiveOr` + `selectFarmSites` fallback |
| Both `activeRuns` keys removed on finish | `cookieRobot.ts:735-736` |
| Consent wait polls the kill switch | `consent.ts:674` `shouldStop` |
| `whoami` by absolute path | `securePreferences.ts:19-20` `SystemRoot/System32/whoami.exe` |

## C6 — Test suite green: **PASS**

`npx vitest run` → `Test Files 156 passed (156)`, `Tests 1283 passed | 12 skipped (1295)`, exit 0.

---

## Defects found

None.

## Not verified

Nothing material was left unverified for this scope. (The interactive desktop click inside the Tauri
GUI window remains unverifiable in a headless environment; it belongs to the previous delivery and
was covered there by renderer typecheck plus end-to-end HTTP execution of the same handler.)

VERDICT: ACCEPT
