# Recon — five reported defects

Operator message (verbatim, 2026-09-19):

> Нет адапитвности, колонка ACTION зависит от сайза окна, такого быть не должно. И проверь что
> профили трасферятся правильно, сейчас почему не перенеслись названия профилей. Нужно чтобы
> переносились сесии и все остальное.
>
> так же  убери возможность сворачивать левое меню, эта стрелочка не нужна. Еще такая ошибка
> (на последнем скриншоте)
>
> Еще когда мы закрываем в трее nulltrace, все открытые профиля должна закрываться

## Files touched (by slice)

| Slice | Files |
|---|---|
| A table | `src/renderer/src/styles.css`, `src/renderer/src/pages/Profiles.tsx` |
| B transfer | `src/main/api/routes/proxy.ts`, `tests/unit/dataTransfer.test.ts` |
| C stealth | `src/main/security/stealthKey.ts` (new), `src/main/security/extensionVerifier.ts`, `src/main/launcher/chromium.ts` (startProfile block), `tests/unit/stealthKey.test.ts` (new) |
| D lifecycle | `src/main/index.ts`, `src/main/launcher/chromium.ts` (stopAll), `src-tauri/src/main.rs`, `src-tauri/src/tray.rs` |

## What was established, with evidence

**R01 table.** `.table-container` is `overflow: hidden` (`styles.css:1154-1162`). The profiles
columns are `24+18+12+13+11+8+14 = 100%` of the remaining width **plus** a fixed 40px checkbox
column, so the last column overflows a container that cannot scroll. Matches the operator's
screenshot: `ACTIO` cut mid-word, no scrollbar.

**R02 names.** Reproduced without the server by replaying the exact SQL: destination holding
`STALE NAME` for id `src-p1` kept it after `INSERT OR IGNORE`, and the transfer therefore
reported the row as `skipped`. The transfer was telling the truth about what it did — it was
doing the wrong thing.

**R03 sessions.** The route copies rows for `groups, proxies, fingerprints, devices, profiles`
and then copies `profiles/<id>/` directories. It never touched `profile_extensions` or
`profile_tags`, both keyed by `profile_id`, so a transferred profile arrives without its
extension bindings. The workspace copy counts `cpSync` calls rather than verifying content.

**R04 collapse.** Already removed in 0.6.9 (commit `6c55775`). `grep sidebar-toggle-btn` → 0 hits
in `src/renderer/src/` and 0 in `dist/renderer/assets/*.js`. The operator's screenshot showing the
chevron is from an older build. Re-asserted as a requirement so it cannot return.

**R05 stealth.** Reproduced twice, the second time on the operator's own artifact:

```
[SECURITY FAILURE] Stealth extension 'p_f868bb' integrity verification failed
(key-not-found: Key ID b19086e17836e036 not in keyring).
```

Three separate node processes produced three different ephemeral keyIds
(`2e3018c8334d81c6`, `2996738274475c93`, `64950353afbe1623`). The artifact is signed per process
and stored on disk, so the next process cannot verify it. Live effect on the machine: launching
profile `p_f868bb1c-…` now answers
`{"code":-1,"msg":"Security Remediation Required: Stealth extension verification failed ... key-not-found"}`.

**R07/R08 tray.** Measured the process tree: `nulltrace-tauri-shell.exe 44896` →
`node.exe 14984` (backend) → `chrome.exe 27856`. `POST /api/v1/shutdown` does stop chrome
(6 → 0 within 2s) and releases the port, so the backend's own stop path is sound. The shell's
exit path is the suspect: `tray.rs` "quit" calls `app.exit(0)` while `main.rs` runs
`perform_graceful_teardown` inside the `ExitRequested | Exit` arm, and that teardown waits up to
5 s for the child to exit — a wait `app.exit(0)` does not obviously await. Slice D is required to
prove which of the three candidate mechanisms it is from the code before changing anything.

## Acceptance check (planned, executed after the slices land)

| Req | How it will be proven |
|---|---|
| R01 | Live: table at 900/1100/1400px; every action button's right edge inside the container box |
| R02 | Live: transfer a folder whose db holds a differently-named profile with the same id |
| R03 | Live: cookies/login file present and non-empty in the destination; `profile_extensions` rows carried |
| R04 | `grep` 0 hits in source and bundle; live DOM has no collapse control |
| R05 | Two-process sign/verify; and a live launch of `p_f868bb1c-…` succeeding |
| R06 | Tampered `stealth.js` still refused with `digest-mismatch` |
| R07 | Live: launch 2 profiles, tray-quit, 0 Chromium processes remain |
| R08 | Injected stop failure: app still exits within the bound and names the profile id |

## Caveat carried into the oracle brief

`D:\progg\NULLTRACE` from the operator's error screenshot does not exist on this machine
(verified). The failing workspace could not be inspected, so R02/R03 are written to hold for any
source folder and were reproduced against synthetic fixtures plus the live `D:\NULLTRACE`.
