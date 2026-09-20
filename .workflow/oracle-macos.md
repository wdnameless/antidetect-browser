# Oracle verdict — macOS arm64 slice

## Verdict: ACCEPT (PASS_WITH_CONCERNS)

Independent blind audit (`MacOracle`) against the operator's request and the spec, not against the
commits. All eight gates passed: `operator_request_met`, `manifest_r01_r10`, `windows_regression_free`,
`network_path_evidence`, `vocabulary_drift_gate`, `seam_check`, `deep_module_gate`, `adr_conflict`.

### Claims it tried to falsify, and could not

| Claim | Outcome |
|---|---|
| The dmg extraction works and was genuinely exercised | SURVIVED — acceptance job ran `e2e-macos-kernel.mjs` against the live image |
| Nothing writes inside the `.app`; the root anchors beside it | SURVIVED — traced settings, data, api_key and the webview cache |
| The app builds, is signed, and has the chosen layout | SURVIVED — `codesign --verify` in the run log |
| The kernel is native arm64 with stealth intact | SURVIVED — `lipo -archs: arm64`, `webdriver` false |
| Windows did not regress | SURVIVED — Windows jobs green |
| The vendored Node digest is genuine | SURVIVED — matched against nodejs.org's published SHASUMS256.txt |
| The `prebuild`/`pretypecheck` hooks are safe | SURVIVED — do not mask a missing `dist/` |

### Its two concerns, checked by me rather than accepted

**1. "Detach failure is ignored with `console.warn`."** The description was wrong — it was ignored
with **nothing at all**, which is worse than reported. Real, and fixed: the failure is now reported
with the exact command to recover, because an image left mounted also shifts the next attempt's
mount point to `/Volumes/Chromium 1`.

**2. "Concurrent acquisitions lack cross-process locking."** Not reachable as described: the install
route joins an in-flight attempt (`api/routes/kernel.ts`) and the desktop shell is a single-instance
app, so two extractions of the same kernel cannot overlap within a running app. Kept as a note for a
future headless/multi-process deployment rather than a defect in the shipped path.

### Two defects the oracle did not find, found by reading the code I had just written

- A stale bundle surviving `rmSync` would be **merged into** by `cp -R`, producing a blend of two
  extractions that no digest covers. Now an error instead of a silent blend.
- A partial download was never reclaimed off the happy path: the cleanup only knew the file it
  created itself, so a crash mid-download left a 134-190 MB payload permanently. Now reclaimed,
  age-gated at one hour so a live attempt is never touched.

### What the oracle did not verify

Real physical Apple Silicon hardware outside the `macos-14` runner, and launching the `.app` by
double-click with real profiles. Both are recorded as unverified in the README and the recon notes —
the operator's own machine is the only place they can be settled.
