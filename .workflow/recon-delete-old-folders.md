# Recon — delete an old data folder after transfer, and re-scan after deletion

Operator (verbatim):

> «должна быть кнопка рядом с transfer to current delete old profiles после того как перенёс
> в основную — так же рескан после удаления должен работать»

Lane T1. Scope: a delete control in a scan row, guarded by "the profiles are already in the
folder in use", plus a live re-scan so a removed folder stops being listed.

## The finding that decides the design: transfer copies database rows only

`POST /api/v1/data/transfer` (`src/main/api/routes/proxy.ts`) reads the source `antidetect.db`
with sql.js and inserts rows into `groups`, `proxies`, `fingerprints`, `devices`, `profiles`.
It performs **no filesystem copy at all** (verified: no `cpSync`/`copyFile`/`promises.cp`
anywhere in that route).

A profile's browser state does not live in those rows. It lives in `profiles/<id>/`:
`Default/Cookies`, `Default/Login Data`, `Default/Local Storage`, `Default/Preferences`.
Measured on this machine (`C:\Users\Administrator\.antidetect\data`): 9.0 MB total, of which
**8.5 MB is one profile workspace** holding a `Login Data` file — real logins, and
`cookies_json` is `NULL` for all three source profiles, so the database carries none of it.

Therefore transferring rows and then deleting the source folder **destroys every session in
it**, silently: the profile still appears in the list and launches, as a brand-new browser with
no logins. The requested feature is unsafe on top of the current transfer, so the transfer
copies the workspace as well. That is what makes deletion honest.

Copy rule: fill in what is missing, never overwrite. The folder in use is the authoritative
state for a profile id, so `fs.cpSync(src, dest, { recursive: true, force: false,
errorOnExist: false })` merges both.

## Live state measured before the change

| Folder | Rows in its DB | Workspaces on disk |
|---|---|---|
| `D:\NULLTRACE` (in use) | 0 | 0 |
| `C:\Users\Administrator\.antidetect\data` | 3 | 1 |
| `C:\Users\Administrator\AppData\Roaming\antidetect-browser\data` | 0 | 0 |

`GET /api/v1/data/scan` against the running app (key from `GET /ui/key`) returns exactly these,
so the delete control has real rows to act on.

## Why the delete goes to the Recycle Bin

Irreversible `fs.rmSync` on someone's browser data, one click away, is not a defensible
default. On Windows the folder is sent to the Recycle Bin through
`Microsoft.VisualBasic.FileIO.FileSystem::DeleteDirectory(..., 'SendToRecycleBin')` — the same
PowerShell route the codebase already uses in `src/main/io/cookieSqlite.ts`. Verified on this
machine: the call returns success and the path is gone from disk. Other platforms refuse with
an explicit message rather than silently deleting permanently — this product ships Windows only
(CI publishes `windows-latest` alone).

## Guards (server-side, not in the UI)

1. Never the folder in use (`getDataDir()`), compared case-insensitively.
2. Must exist, and must look like a data folder (`antidetect.db` or `profiles/`).
3. **Every profile id in the source database must already be in the current one.** This is the
   operator's own rule — "после того как перенёс в основную" — enforced where it cannot be
   bypassed. The refusal carries `reason: 'not-transferred'` and a `missing` count so the UI can
   say it in Russian.

## Files to touch

| File | Change |
|---|---|
| `src/main/api/routes/proxy.ts` | transfer copies workspaces (new `workspaces` count); new `POST /api/v1/data/delete` |
| `src/renderer/src/api.ts` | `dataDelete(dir)` client |
| `src/renderer/src/pages/Settings.tsx` | per-row delete control, `deletingDir` state, scan extracted to `runScan()` and re-run after a delete |
| `src/renderer/src/i18n.tsx` | RU + EN strings |
| `tests/unit/dataTransfer.test.ts` | workspace copy asserted |
| `tests/unit/dataDelete.test.ts` | new: guards + the full scan → transfer → delete → re-scan journey |

## Acceptance check (executed)

Live backend on `127.0.0.1:50925` (`ANTIDETECT_DATA_DIR`/`ANTIDETECT_SETTINGS_DIR`/`HOME` sandboxed under
`D:\tmp-nt-verify`, so nothing of the operator's was touched), plus the real UI served from it:

| Scenario | Result |
|---|---|
| Delete before transfer | `{"code":-1,...,"reason":"not-transferred","missing":1}`; source untouched |
| Delete the folder in use | `{"reason":"current"}`; folder untouched |
| Delete a non-data directory | `{"reason":"not-a-data-folder"}`; directory untouched |
| Delete a missing path | `{"reason":"missing"}` |
| Transfer | `{"created":1,"workspaces":1,"workspace_failures":[]}` |
| Sessions after transfer | `profiles/p_verify_1111/Default/{Cookies,Login Data}` present with their bytes |
| Delete after transfer | `{"ok":true,"reason":"deleted","recycled":true}`; source gone from disk |
| Sessions after delete | still present under the folder in use |
| Re-scan after delete | the deleted folder is no longer listed |
| UI button | `Delete folder` renders beside `Transfer profiles here` (screenshot) |
| UI refusal | `This folder still holds profiles that are not in the folder in use: 1. Transfer it first.` |
| UI success | `Transferred 1 profiles, 3 already present (1 folders), 1 browser workspaces copied` then row count → 0 |
| Full suite | `npm test` 132 files / 1089 passed, 1 skipped |
| Typecheck | clean (main + renderer) |
| SBOM | `npm run sbom:verify` succeeded |

Shipped as **v0.6.10**: commit `a8ee9ff`.

## A defect this found in my own test, worth recording

`sql.js`'s `Statement.run()` takes ONE array of values; varargs bind nothing and write NULLs.
`node_modules/sql.js` is used raw in tests (the app wraps it with a `normalize()` that unpacks
varargs). A test written with `.run(a, b)` silently inserted `(null, null)`, and the guard then
reported every profile as missing. The production transfer route already calls
`.run(...params)` on the *wrapped* handle, which is correct — but the distinction is a trap
for the next test.
