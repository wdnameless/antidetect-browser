# Blind acceptance — release 0.6.44

The reviewer was given **only the operator's brief** and told explicitly not to read any
spec/manifest/recon written by the author. It re-derived each claim from the code and the tests.

## Verdict: **ACCEPT** — defects found: none

## Evidence it produced independently

| Brief item | Its trace |
|---|---|
| 1. Language does not change | `Profiles.tsx:2862` select includes all catalog locales + the stored locale → save at `Profiles.tsx:992,1025` → `saveFingerprintConfig` → `/browser-profile/fingerprint` → `profileManager.ts:1658,1807` → `chromium.ts:313` sets `--lang`/`--accept-lang`. Tests: `profileLanguage.test.ts` 7/7, `profileLanguagesEndpoint.test.ts` 2/2. |
| 2. Profile created inside a group | `Profiles.tsx:800` sets `groupId` from `selectedGroupFilter \|\| ''`; save sends `group_id`. Test: `profileLanguage.test.ts:145`. |
| 3. Bug hunt + release | `mobile_model_id` returned (`profileManager.ts:856`); group rename omits bookmarks so the column is untouched (`Groups.tsx:70`); extension bind merges (`Extensions.tsx:106-109`); randomize writes `config_json` coherently (`profileManager.ts:1431`); saved proxy queues the geo check (`profileManager.ts:526`); version 0.6.44 synced across `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`. Tests: `fieldPersistence.test.ts` 4/4, `bulkFingerprint.test.ts` 7/7, `tauriShell.test.ts` 10/10. |

## What the reviewer could not verify, stated honestly

1. **A live Chromium process launch inspected over CDP.** It verified the flag construction
   statically and through the suites. *The author did verify this separately* on the real kernel
   (`chrome.dll`, fingerprint-chromium 148.0.7778.215): `--lang`/`--accept-lang` are applied on a
   first launch **and** on a relaunch with a changed value, confirmed via `navigator.languages`,
   the UI locale on `chrome://settings`, and the real `Accept-Language` HTTP header.
2. The preflight auto-fix's bare two-letter language codes — already recorded as a Known Issue in
   the changelog rather than silently left.

## Note on the reviewer's independence

It reported the same line numbers the author's own verification produced, from the opposite
direction (starting at the operator's symptom rather than at the diff). No disagreement was found
between its conclusions and the author's, and it raised no defect the author had missed — which is
the outcome that matters, since a reviewer that only echoes the author's summary would add nothing.
