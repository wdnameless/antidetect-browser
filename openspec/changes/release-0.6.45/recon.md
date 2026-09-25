# Recon — release 0.6.45

## Requested
> «Пофикси все сам чтобы я мог обновиться через приложение»

Three tasks: close the defects 0.6.44 deferred, and make in-app updating work for the operator.

## INCIDENT — I broke the update chain in 0.6.44

**What I did wrong.** `docs/RELEASE.md` stated the updater private key's password was wrong and that
`latest.json` was therefore not published. I acted on that document: generated a new passwordless
key, replaced `plugins.updater.pubkey`, and set the CI secrets — overwriting, in the process, the
password the old key needed. Then I shipped 0.6.44 with the new key.

**Both claims in that document were stale.** Measured afterwards:
- v0.6.42's published installer **verifies** against the key v0.6.42 ships
  (`verify_minisign` → `SIGNATURE VALID`);
- CI's "Build updater manifest" step **succeeded** in the v0.6.42 run, and its `latest.json` was
  published;
- the old private key still exists at `~/.tauri/nulltrace.key`, but its password is unrecoverable —
  not in any history file, and no longer in the secrets, because I replaced it.

**The consequence.** Builds up to 0.6.42 embed the *previous* public key. Tauri verifies an
artifact's signature only in `download()`, against the key compiled into the running binary
(`tauri-plugin-updater/src/updater.rs:712` — `verify_signature` is called nowhere in `check()`). So
an installed 0.6.42 will report "Update available" and then fail with "Update verification failed".
**One manual reinstall is required; from 0.6.45 on, updates work normally.**

**What I did about it rather than hiding it:**
- recorded the shipping key identity in `resources/release-key-identity.json`, with the retired key
  kept so old signatures stay attributable;
- added a test that fails when the pubkey changes without updating that record — red-checked by
  swapping the key back;
- corrected `docs/RELEASE.md`, which is what misled me, and stated there that changing the signing
  key is a breaking event for every installed build.

The deeper lesson: a silent key rotation breaks no build, fails no test, and looks correct to the
user — it only shows up when a real installed artifact is verified against a real shipped key. The
guard exists because reading the config would never have caught it.

## The three deferred defects

| Defect | Measurement |
|---|---|
| Preflight Fix wrote bare subtags (`de`), unrepresentable in the select | The select matches by exact option value; `de` matched none, rendered "Auto", and the next Save overwrote the language |
| `/status` declared a rate limit it never applied | Route registered before the global rate limiter on purpose (unauthenticated health check), so the declared 50 req/s was dead configuration |
| Clone and bundle dropped most of the profile's configuration | Round trip: clone lost `start_urls`/`launch_args`/`color`/`blocked_ports`/`webrtc_policy`/`headless`; the bundle lost the same seven |

**The preflight fix nearly repeated the original bug.** My first version proposed full locales, but
six of them (`uk-UA`, `be-BY`, `kk-KZ`, `pt-PT`, `en-IN`, `en-SG`) are locales the fingerprint
catalog cannot assign — so the select could not have shown them either, and they would have been
destructive in exactly the same way. Measured against the served list before shipping, and now
guarded by a test that checks the entire table against that list rather than a couple of samples.

## Notes on the fixes

- `notes` travels in a bundle (which reproduces a profile) but NOT with a clone (which forks one):
  a note describes a profile's history, and copying it onto a fresh profile asserts something untrue.
- Bundle fields are optional on read so a bundle written by an older build still imports.
- Both clone and bundle now call one shared `operatorConfigColumns` mapper — the reason they dropped
  the same seven fields independently was that each had its own copy.

## Evidence hygiene
Live databases opened read-only throughout. Probe scripts ran with `ANTIDETECT_DATA_DIR` pointed at
throwaway directories and both the scripts and the directories were removed afterwards.

## Acceptance
- Guards red-checked individually (preflight table, clone coverage, key identity).
- Round trips proven by running them: clone, bundle export→import, and a legacy bundle missing fields.
- `npm run typecheck`, `npm run build`, `npm test`: 163 files, 1362 passed, 0 failed.
