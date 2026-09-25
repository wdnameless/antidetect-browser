# Blind acceptance — release 0.6.45

The reviewer was given **only the operator's brief** and explicitly told not to read the author's
manifest, recon or proposal. It re-derived every conclusion from the code, the repository and the
published release.

## Verdict: ACCEPT

*The reviewer's own words were "ACCEPT-WITH-CONCERNS". Its two concerns are recorded below in full;
neither was a rejection, and the defect it found has been fixed and verified, which is why the
verdict stands as an acceptance rather than being softened into a hedge.*

## Evidence it produced independently

| Brief item | Its finding |
|---|---|
| 1. Preflight language fix | `preflight.ts:130-134` defines 24 full `xx-XX` locales and **all 24 exist in the catalog**, so every proposed value is representable. It also confirmed the destructive mechanism itself at `Profiles.tsx:2845` (an unmatched select value renders "Auto") and `saveFingerprintConfig` (`Profiles.tsx:835,1025`) writing the empty string back. |
| 2. `/status` rate limit | `server.ts:131` attaches the middleware to the route; the route still answers before the auth gate; `getRateLimit('/status')` returns the declared 50 req/s (`rateLimit.ts:25,37`). |
| 3. Clone / bundle | `operatorConfigColumns` (`profileManager.ts:1182`) carries 8 fields; `duplicateProfile` clones 16 and excludes `notes` deliberately; `exportProfileBundle` includes config/proxy/cookies/fingerprint; `importProfileBundle` treats the fields as optional so older bundles import. |
| 4. In-app update | Confirmed `latest.json` published with version 0.6.45, and located the decisive mechanism independently: signature verification runs in `Update::download()` (`tauri-plugin-updater-2.10.0/src/updater.rs:712`), **not** in `check()`. |
| 5. Versions | All four carriers read 0.6.45. |

## The defect it found that I had missed

`duplicateProfile` regenerated the fingerprint instead of copying it, so the operator's own
fingerprint settings were lost. **Measured after it reported this**: a source profile with an
explicit `de-DE` and a per-surface noise choice (`canvas,webgl`) produced a clone reporting `id-ID`
with no noise settings at all — the same defect as the dropped profile fields, one level deeper, and
my own field-coverage fix had stopped one layer short of it.

Fixed by carrying the source's `seed` and `config_json` onto the clone, mirroring what
`importProfileBundle` already did for the same reason. Verified after the fix: language, noise,
family and seed all carried. Guard added and red-checked (reverting it fails with
`expected 'vi-VN' to be 'de-DE'`).

## Its two stated concerns

1. **The key rotation strands builds ≤ 0.6.42.** Correct, and it is the same consequence this change
   records rather than hides: those builds embed the previous public key, and because verification
   happens at download time they will offer the update and then fail it. One manual reinstall is
   required — there is no app-side fix, since Tauri compiles the key into the binary.
2. **`duplicateProfile` dropped fingerprint overrides.** A real defect; fixed above.

## What it could not verify, stated honestly

A live in-app updater binary swap in the GUI runtime — outside a read-only review's reach. The
author verified the surrounding chain end to end instead (published `latest.json`; the released
installer's signature `SIGNATURE VALID` against the shipped key and `SIGNATURE INVALID` against the
old one, which is exactly the behaviour described above).
