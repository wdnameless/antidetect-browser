# Recon — editor: no section tabs, Real/Auto noise per surface

## Requested
> «сверху давай уберм подгруппы (IDENTITY,LOCATE,PRIVACY etc)
> В noise должен быть выбор real\auto noise на все пункты как в shardx, в целом возьми оттуда
> интерфейс в настройки профиля, только соедени с нашим фунционалом»

## What already existed (reuse > create)

| Thing | Where | Reused as |
|---|---|---|
| `--disable-spoofing=<tokens>` | kernel, `docs/KERNEL.md:60` | the real switch behind Real/Auto — no new mechanism |
| `fingerprint.config.disableSpoofing` → `--disable-spoofing=` | `profileManager.ts:1578`, `chromium.ts:304` | the persistence + launch path, already wired end to end |
| fingerprint-config write pattern (`{...cfg, ...}` via `profileUpdateFingerprint`) | `saveProfileLanguage` precedent | generalised, not duplicated |
| `.mode-selector` / `.mode-btn` segmented control | `styles.css:2339` | visual language for the toggle |
| 3-column `profile-form-grid` + 1180px modal | `styles.css:2603` | the shardx layout was already ported; left as is |

## Measured before building

Ran the repo's own deterministic probe (`.stealth-bench/probe.mjs`) against the pinned kernel with
`--fingerprint=424242` plus one token each:

| token | canvas hash | font count | verdict |
|---|---|---|---|
| (none) | `1d92251d` | 17 | baseline |
| `canvas` | `343618cd` | 17 | **changes the browser** |
| `font` | `1d92251d` | 18 | **changes the browser** |
| `audio` | unchanged | 17 | documented, not resolved by this probe |
| `clientrects` | unchanged | 17 | documented, not resolved by this probe |
| `gpu` | unchanged | 17 | documented, not resolved by this probe |

The probe's audio measure is a fixed `sum` that does not move with noise, and `gl` came back null,
so three tokens could not be confirmed either way. They are offered because the kernel documents
them, and `NOISE_SURFACES` records which are measured rather than presenting all five as equally
proven. `gpu` is the current spelling — the repo's older `webgl` token was **not** in the kernel's
documented set and would have been accepted silently and ignored.

## Changes

- **Section jump bar removed.** The headings already label their groups; the bar was a second
  navigation surface for a form that fits.
- **NOISE offers Auto/Real per surface** (Canvas, Fonts, Audio, Client rects, WebGL/GPU), written to
  `fingerprint.config.disableSpoofing` and therefore to `--disable-spoofing=`, in ONE
  read-modify-write shared with `lang`.
- **Sensors stays informational** — `resolveSensorConfig` returns null for anything that is not a
  MOBILE profile and the kernel has no token for it, so a switch there could not act on the profile
  showing it.
- **The summary badge was fixed.** It hardcoded `Canvas & Audio Noise: Active (Per-Seed Hash)`; with
  Real now selectable it would have asserted the opposite of what the launch was about to do. It
  reports the actual choice.

## Acceptance check

- Rendered on a source-run service: jump bar absent, **5** noise toggles, Sensors note present,
  grid still 3 columns (`noise-ui.png`).
- Clicking Real on Canvas + Fonts flips the control and updates the summary to
  `Real: Canvas, Fonts` (`noise-real.png`).
- The choice reaches the launch: `disableSpoofing: "canvas,font"` → `--disable-spoofing=canvas,font`.
- `tests/unit/profileLanguage.test.ts` generalised: it matched a helper NAME, so a rename broke it
  while the behaviour was intact. It now matches the argument (`lang: profileLang`), extends the same
  rule to the new field, and asserts the two values share one write. Proven red by deleting the
  create-branch write (1 failure), then green.
- Both typechecks clean; suite 157 files / 1308 passed.
