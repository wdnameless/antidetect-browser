# Recon — browser language is not saved

Operator: «не сохраняется язык браузера», with the Edit Profile modal showing `Browser language: es-ES`.

## Root cause (proven)

`profileLang` was read and rendered, but never sent on save.

- `src/renderer/src/pages/Profiles.tsx:493` read it: `setProfileLang(fpCfg.lang …)` from
  `fingerprint.config.lang`.
- The select at `:2348` bound it as `value`.
- The save handler sent name, group, device, model, user-agent, proxy, colour, timezone,
  `do_not_track`, `blocked_ports`, `webrtc_policy` — **no language**, in either the create or the
  edit branch. `profileUpdate` in `src/renderer/src/api.ts:545` has no language field to send, and
  the `profiles` table has no column for it (`PRAGMA table_info(profiles)` confirms).

The value lives at `fingerprint.config.lang` and is written by a different route,
`POST /api/v1/browser-profile/fingerprint`. Reproduced against the live app: the update route left
the stored language untouched, while the fingerprint route moved it `fr-FR → es-ES → fr-FR`.

## Why it matters — the value reaches the browser

`src/main/launcher/chromium.ts:250-252`:

```
if (cfg.fingerprint.lang) {
  args.push(`--lang=${cfg.fingerprint.lang}`);
  args.push(`--accept-lang=${cfg.fingerprint.lang}`);
}
```

and `src/main/proxy/stealthInjection.ts:1202` reports it as `lang`. Confirmed on a real launch:
the Chromium process command line carried `--lang=de-DE --accept-lang=de-DE`, and the page answered
`navigator.language = "de-DE"` over CDP. A dropped language changes what every site sees.

## Two further defects found while fixing it

1. **Create discarded the language too**, not only edit — a language chosen in the create form was
   lost the same way.
2. **"Auto" was unreachable.** The select's Auto option has an empty value, while the form default
   (and the modal reset) were `'en-US'`. A fresh form displayed Auto and held en-US, so the state
   disagreed with its own control and the seed-derived locale could not be chosen without touching
   the dropdown. Both now use `''`.

## Files touched

| File | Change |
|---|---|
| `src/renderer/src/pages/Profiles.tsx` | new `saveProfileLanguage(userId, lang)` writing through the fingerprint route; called from BOTH save branches; default and reset changed to `''`; edit-load no longer substitutes `en-US` |
| `tests/unit/profileLanguage.test.ts` | new — the save path must use every field the modal collects |

## Acceptance check (executed)

| Check | Result |
|---|---|
| Language survives a save via the fixed path | `fr-FR` → `de-DE` → read back `de-DE` |
| The launcher passes it to Chromium | process command line: `--lang=de-DE --accept-lang=de-DE` |
| The page sees it | CDP `Runtime.evaluate`: `{"language":"de-DE","languages":["de-DE"]}` |
| "Auto" is reachable and means no explicit language | stored `''`, launcher emits no `--lang` |
| Create also saves it | second call site present, asserted by the test |
| The test fails on the shipped behaviour | removing both saves → 2 of 4 fail |
| No regressions | vitest 138 files / 1132 passed; typecheck clean |

## Restored afterwards

The operator's profile was put back to its original `fr-FR`, and the profile launched during
testing was stopped.
