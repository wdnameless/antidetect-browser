# Recon — sharper icon, and the profile name in the taskbar hover

Operator (verbatim):

> «Хочу изменить иконку, сделать ее более качественной, четкой. И в профиле когда наводишь на
> панели задач, там должно быть название профиля.»

Two asks: (1) the app icon is not crisp; (2) hovering a launched profile's taskbar button must
show the profile name.

## Ask 2 — the root cause is a CDP command that does not exist

`src/main/launcher/chromium.ts:552` sets the window title with `Page.setTitle`. **That command
is not in the Chrome DevTools Protocol.** Verified by fetching the running kernel's own
protocol: `Chrome/148.0.7778.215` returns *zero* title-related commands across every domain.
The call is wrapped in `.catch(() => undefined)` inside a try/catch that swallows everything,
so it has never done anything and never said so — a silent no-op behind a comment claiming it
prepends a badge.

Measured on this machine, in a real kernel window (WinAPI `EnumWindows` + `GetWindowTextW`,
scoped to the spawned PID so the operator's own browser is never touched):

| Mechanism | ASCII title | Unicode (Cyrillic) title | Survives page retitle |
|---|---|---|---|
| `--window-name=<value>` | **works** | **ignored** (falls back) | **yes** |
| `Page.setTitle` (today's code) | no-op | no-op | — |
| `SetWindowTextW` after launch | works | works | **no** — a page that sets `document.title` overwrites it 4 s later |

So the flag is the only durable mechanism, and it is ASCII-only. Options weighed:

1. `--window-name` only — durable, but a Cyrillic profile name (which this operator uses)
   silently falls back to "about:blank - Chromium". Worst of both: it looks like it works.
2. `SetWindowTextW` only — accepts Cyrillic, but the first page that sets `document.title`
   erases it, and every subsequent navigation does too.
3. **Both, with a re-apply.** The flag pins the title for ASCII names; for names the flag
   cannot carry, the title is set through WinAPI when the window appears, and a short watch
   re-applies it if a page overwrites it. The watch only lives while the profile runs.

Chosen: **3**. A name that the kernel cannot carry must still appear, and it must not be
erased by the first website that sets a title — that is the whole point of the feature.

Also: `--window-name=<flag>` uses ASCII, but `SetWindowTextW` is the Unicode API, so a mixed
name is written as `«Профиль 1 — NullTrace»` (the operator's own badge/name shape) rather than
being mangled to `?????`. The ASCII fallback for the flag is the transliterated/sanitised form
of the same string, never a different string.

## Ask 1 — the icon is not crisp because of grain, and because sizes Windows asks for are missing

`src-tauri/icons/icon.ico` carries 16/32/48/64/128/256, all PNG. Two defects:

- **The master is deliberately grained.** `scripts/generate-icons.py:161-181` stamps
  "screen-printed noise" into every ink pixel of the 1024 master (a deterministic hash, up to
  +30 per channel), and the `.ico` is built by downscaling *that*. At 16-48 px the grain is
  most of a pixel, so the mark reads as dirty/blurry — which is what "не чёткая" describes.
  The JS generator (`generate-app-icon.mjs`) does **not** grain: it supersamples 4× and
  rasterises clean, which is why `resources/icon.png` and the tray icon look right while the
  `.exe` icon does not.
- **No 20/24/40 px entries.** Windows draws a taskbar/Explorer icon at 16/20/24/32/40/48
  depending on DPI and view; a size that is absent is LANCZOS-downscaled by the shell at
  whatever moment it needs it, on a timer, which produces soft edges. Supplying the exact
  sizes removes that step. Measured DPI here: 96 → the taskbar asks for 32, Explorer for 16,
  the Alt-Tab switcher for 48, and 100/125/150 % DPI ask for 40/48/64. `ico_sizes` is only
  `[16, 32, 48, 64, 128, 256]`.

Chosen: rebuild the `.ico` from the **clean** geometry at all seven sizes
`[16, 20, 24, 32, 40, 48, 64, 128, 256]`, keeping the existing silhouette/eye cutouts exactly
(the operator's mark, unchanged — this is a quality change, not a redesign), and drop the
grain from the raster that feeds every packaged artefact. `assets/brand/*.png` and
`resources/*.png` come from the same clean master so the whole set is consistent.

The SVG master keeps `feTurbulence`: that grain is a *vector* effect, costs nothing at small
sizes because nothing renders the SVG as an icon, and `iconAssets.test.ts` asserts its presence.

## Files to touch

| File | Change |
|---|---|
| `scripts/generate-icons.py` | clean master for raster targets; 20/24/40 added to the `.ico`; no grain anywhere |
| `src/main/launcher/chromium.ts` | replace the dead `Page.setTitle` block with `--window-name` + a WinAPI title keeper |
| `src/main/profiles/profileManager.ts` | a helper that yields the ASCII window-name and the display title |
| `tests/unit/*` | pin the title helpers and the icon entries |

## Acceptance check

- `icon.ico` contains every size Windows asks for, each rendered from clean geometry.
- Taskbar/Explorer icon is visibly sharper (side-by-side render at 16/20/24/32/40/48).
- A launched profile's window title is the profile name; ASCII and Cyrillic both.
- The title survives a page that sets `document.title` after load.
- `npm run typecheck` clean, `npm test` green.
