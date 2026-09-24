# Recon — a profile opened no window while reporting success

## Reported
Pressing a profile does not open its browser. Profile named: **MAIN X**.

## Evidence chain (measured, not inferred)

| Step | Command | Observed |
|---|---|---|
| Reproduce | `POST /api/v2/browser-profile/start` (MAIN X) | `code:0`, `pid:6552`, `debug_port:54762` — API says success |
| Process is real | `Get-CimInstance Win32_Process` | pid alive, CDP `/json/version` answers `Chrome/148` |
| Window missing | command line inspection | `--headless=new` present |
| Discriminate | same probe on a profile with `launch_args = NULL` | `--headless` **absent** — the only difference |
| Root cause | `src/main/profiles/profileManager.ts:386` (`appendProfileArgs`) | profile args are appended **LAST** (Chromium last-wins) |
| Why it overrode the column | `resolveLaunchConfig` sets `headless: profile.headless === 1`; MAIN X's column is `NULL` (headed) | the stored arg beat the column |
| Why it was allowed | `DENIED_LAUNCH_ARGS` covered `--user-data-dir`, `--proxy-server`, `--fingerprint`, `--remote-debugging`, `--load-extension`, `--disable-extensions` — but not `--headless` | display mode had no owner |

MAIN X was the only profile carrying it: `launch_args = ["--headless=new"]`.
Nothing in the app writes that value (the launch_args UI is absent; the SDKs' `standalone` path
builds its own argv and never sends `launch_args`), so the row predates the denylist and was
written through the API or by hand.

## Fix (two doors, one seam)
1. `--headless` joined `DENIED_LAUNCH_ARGS` → cannot be saved again.
2. `parseLaunchArgsColumn` drops denied tokens on **read** → rows already carrying it heal,
   instead of becoming permanently unlaunchable. Single parse point, so the detail view and
   `resolveLaunchConfig` agree.

## Acceptance check
- `tests/unit/launchArgs.test.ts` — 5 new cases; the two read-path cases fail with the read-time
  filter removed (verified red, then green).
- Full suite: 156 files / 1300 passed.
- Live service: MAIN X relaunched headed (pid 936, no `--headless`), and with the overlapping
  second profile stopped, its page reports `document.visibilityState = 'visible'`.
  Headless reports `'hidden'`, so this is a window on screen — not merely a live process.

## Note for the operator
`--window-position=0,0` with no cascade means every profile opens at the same coordinates, so a
second profile launched at the same fingerprint size sits exactly on top of the first. That is why
MAIN X first read `hidden`: it was occluded, not windowless.
