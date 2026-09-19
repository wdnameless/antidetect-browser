# Requirements manifest — five reported defects

Operator message (verbatim, 2026-09-19):

> Нет адапитвности, колонка ACTION зависит от сайза окна, такого быть не должно. И проверь что
> профили трасферятся правильно, сейчас почему не перенеслись названия профилей. Нужно чтобы
> переносились сесии и все остальное.
>
> так же  убери возможность сворачивать левое меню, эта стрелочка не нужна. Еще такая ошибка
> (на последнем скриншоте)
>
> Еще когда мы закрываем в трее nulltrace, все открытые профиля должна закрываться

Answered forks (Wave 0 widget):

> conflict: Побеждает источник (обновлять запись)
> narrow: Горизонтальная прокрутка, ACTIONS закреплена справа
> stealth: Хранить ключ постоянно, при несовпадении пересобрать расширение

| ID | Requirement | Verbatim quote | Acceptance (observable) |
|---|---|---|---|
| R01 | The profiles table adapts to window width; the Actions column is never clipped and never depends on window size | «Нет адапитвности, колонка ACTION зависит от сайза окна, такого быть не должно» | At 900px, 1100px and 1400px viewport widths the table scrolls horizontally and **every** action button in the last column is inside the container's visible box (`getBoundingClientRect().right <= container.right + 1`) and clickable |
| R02 | Transferring profiles carries their names across | «сейчас почему не перенеслись названия профилей» | Source holds `name = "X"`; destination holds a stale `name = "Y"` for the same id; after transfer the destination shows `X` |
| R03 | Transferring profiles carries the sessions and everything else, not just rows | «Нужно чтобы переносились сесии и все остальное» | Cookies, Login Data, Local Storage, IndexedDB, extension bindings and per-profile settings for every transferred profile exist in the destination after a transfer, and a launch after transfer is a logged-in browser |
| R04 | There is no control anywhere that collapses the left menu | «убери возможность сворачивать левое меню, эта стрелочка не нужна» | No element with class or id matching `collapse`/`toggle`/`rail`, and no chevron button, is present in the sidebar at any window width; no stored `sidebar.collapsed` preference is read |
| R05 | A profile launch does not fail with `key-not-found` after the app restarts | «Еще такая ошибка (на последнем скриншоте)» — `Stealth extension verification failed ... is key-not-found. Launch aborted` | Sign an artifact in process A, verify it in process B: accepted. Reproduced today as a failure |
| R06 | Stealth artifact integrity is still enforced after R05 — a tampered artifact is still refused | (existing spec: `secure-runtime-supply-chain` 2.2 fail closed) | An artifact whose `stealth.js` bytes were altered after signing is refused with `digest-mismatch`, launch aborted |
| R07 | Quitting NullTrace from the tray closes every open profile | «когда мы закрываем в трее nulltrace, все открытые профиля должна закрываться» | Launch 2 profiles, choose Quit in the tray: within 10s zero Chromium processes belonging to those profiles remain, and their `DevToolsActivePort` files are gone |
| R08 | A tray quit that cannot stop a profile still exits, and says which profile it could not stop | (implied by R07: the operator must not be left with a hung app) | With one profile un-stoppable (simulated failure) the app still exits within 15s and the log names the profile id |

## Out of scope

- Firefox profiles. The transfer, the launch path and the stop-all path are Chromium-only in this
  repository; Firefox has its own `stopAllFirefox` and is not reachable from the product UI today.
- The `D:\progg\NULLTRACE` path in the operator's screenshot: it does not exist on this machine
  (verified), so the failing workspace could not be inspected. R02/R03 are written to hold for any
  source folder.
- Redesigning the profile list's column order or the set of columns.

## Constraints

- Fail-closed security is not weakened: R06 must hold after R05. The key becomes durable; the
  verification is not removed.
- `INSERT OR IGNORE` semantics elsewhere (dependencies: groups, proxies, fingerprints, devices)
  stay additive — only `profiles` becomes source-wins, because that is what the operator asked for
  and it is the table whose stale values he saw.
- No new runtime dependency.
