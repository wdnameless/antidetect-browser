# Recon — ACTIONS rework, menu dedupe, geo-only PROXY column

## Requested
> «В Экшенс оставь Запуск причек, но причек измени иконку на такую же размером, как остальные и
> настройки. И кнопку настройки, поменяй на шестеренку вместо иконки edit. Остальное убери в more
> actions. И в море экшнс проверять, чтобы не было дубликатов функций. Также в колонке прокси я хочу,
> чтобы отображалась Гео. После добавления прокси он должен автоматически проверяться. И если он
> неудачный, то гела не отображается, отображается ошибка крестик. Сейчас отображается протокол и IP
> такое быть не должно.»

## The row before this change

Six buttons of three different shapes:

| Control | Shape | Outcome |
|---|---|---|
| Play / Stop | 32px `.btn-icon` | kept |
| Preflight | wide text badge ("⚠ WARN 2") | **compact 32px square** |
| Warm up (cookie farm) | 32px | **moved to menu** |
| Settings (pencil) | 32px | **gear icon**, same slot |
| Note | 32px | **moved to menu** |
| ⋯ | 32px | kept |

## Duplicates found in the menu

| Menu entry | Duplicate of | Action |
|---|---|---|
| Run Preflight Check | the preflight badge **already in that same row** | removed — clicking the badge runs and opens the modal |
| Randomize Seed | the Settings modal has the same control | **kept** (row-level shortcut; not the same click surface) |
| Fingerprint Config → "Disable Spoofing (advanced)" checkbox list | the NOISE Auto/Real controls added in 0.6.36 | see note below |

The manage-modal list used tokens `canvas, webgl, audio, clientrects` — including `webgl`, which is
**not** in the kernel's documented set, so that checkbox silently did nothing. The NOISE section in
the settings modal uses the correct `gpu`. Both surfaces write the same `disableSpoofing` key.

Warm-up and Note were **not** duplicates of anything in the menu; they moved there because the row
was too wide, so the menu gained both — the change must not lose a function.

## PROXY column

Before: `<PROTOCOL badge> host:port (COUNTRY)` — protocol and address rendered unconditionally.
After: geography only, and a failed check shows a cross.

`listProfiles` did not select the proxy's health, so the column could not distinguish
"never checked" (no geo yet) from "the check failed" (no geo, ever). `px.status` is now carried as
`proxy_status` ('ok' | 'fail' | 'unknown') through the list query, `ProfileListItem` and the
renderer type. `setProxyResult` already persisted 'fail' on a failed check — the data existed, it
simply never reached the table.

Three states, deliberately distinct:
- `fail` → `✕` (danger colour). No location is shown, because a failed proxy has no exit to report.
- geo present → `🇩🇪 DE · Berlin`
- neither → `Not checked yet` (named, so it cannot be confused with a failure)

The address survives in the row's tooltip; the protocol no longer appears in the cell at all.

## Auto-check on add

`create` in the Proxies page now runs `proxyCheck(newId)` before returning. Awaited rather than
fired-and-forgotten so `busy` covers it — otherwise the modal closes, the list reloads, and the row
changes again a second later with no explanation. A failed **check** never surfaces as a failed
**create**: the proxy exists and is listed, and the stored 'fail' drives the row.

The same failure mark was added to the Proxies page's own LOCATION cell, which had the same defect —
a failed proxy read as `Not detected yet`, i.e. "never tried", the opposite of what happened.

## Acceptance check

- Rendered on a source-run service against the scratch workspace; screenshots taken.
- Toggle/preflight/gear/kebab counts and the `✕` on a deliberately-dead proxy.
- Both typechecks clean; suite result recorded in the change notes.
