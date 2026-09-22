# Oracle — blind verification of the preflight badge, the fixes, and release v0.6.28

Auditor: independent acceptance oracle (`OracleBadge`). Read-only on source; it drove the live UI
and the live API itself rather than trusting the repo's probes.

## C1 — the feature is finished and VISIBLE: **PASS**

The badge is rendered in the Actions cell, and the oracle confirmed it in the **rendered DOM** on a
live service (port 50421), which is the only check that could catch this defect class — the component
had been *imported* the whole time, and a typecheck cannot tell an imported component from a
rendered one:

```
.preflight-badge  text "✕FAIL2"  class "preflight-badge fail"  title "Preflight: FAIL (2 issues)"
```

Status, issue count and tooltip all present, with no click.

## C2 — dead code is gone: **PASS**

Zero occurrences remaining in `Profiles.tsx` for `copiedSeed`, `memoryGb`, `osPlatform`,
`mediaMicCount`, `mediaSpeakerCount`, `mediaWebcamCount`, `fpConfig`, `copySeedToClipboard`,
`DevicesIcon`.

## C3 — the P0 is fixed, both directions: **PASS**

Verified against the live API, not by reading:

- profile with a dangling `proxy_id` → preflight `fail`, `reasonCode: proxy-not-found`, launch
  refused with **412**;
- proxy-less profile → preflight passes, launch **allowed**.

Before the fix the first case returned `pass` and launched directly over the host network.

## C4 — the other five preflight fixes: **PASS**

`skipPreflightGuard=true` on the Launch Anyway path only; `openModalAfter=true` from Re-run Checks;
`PREFLIGHT_REASON_REMEDIATION` keyed on the codes the probes actually emit; the language check reads
`cfg.lang` first; `checkQuicRelayState` compares the state string `'relay'`.

## C5 — test suite green: **PASS**

`npx vitest run` → 156 files passed, 1283 passed / 12 skipped (1295), exit 0.

## C6 — the release is published and installable: **PASS**

Assets present on `v0.6.28`; the updater endpoint serves `0.6.28`; and the oracle ran
`verify-release-signature.cjs` itself against **both** the installer and the portable exe — each
`RESULT: VALID`, key id `7FDDA4EFF823F429`, matching the configured pubkey (exit 0).

## C7 — version consistency: **PASS**

`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
(`nulltrace-tauri-shell`) and tag `v0.6.28` all agree.

---

## Defects found

None.

## Not verified / explained

- CI job `Release macOS portable (Apple Silicon)` failed on the tag run. Cause: a GitHub Actions
  infrastructure timeout uploading the artifact (`Failed to CreateArtifact: request timeout after 5
  attempts`). The macOS **build** itself succeeded — only the upload step failed — and the Windows
  release job published normally. The macOS zip carries no `latest.json` entry, so the Windows
  self-update is unaffected. The job was re-run.

VERDICT: ACCEPT
