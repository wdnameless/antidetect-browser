# Recon — Data Folder panel + sidebar navigation (release 0.6.6)

Lane T1. Operator's brief, three defects in one report: the current folder showed blank,
the transfer control had to sit beside Change Folder, and the left nav rendered unevenly.

## Defect 1 — "Current folder" was always blank

`src-tauri/src/bridge.js` `data.getDir()` read `.dir` **off the response envelope**. Every
backend route answers `{code, msg, data}`, so the folder actually lives at `data.data.dir`.
The call returned `''` on every invocation while the app was happily serving profiles.

Evidence — live backend, key from `D:\NULLTRACE\api_key`:

    GET /api/v1/data/dir -> {"code":0,"msg":"success","data":{"dir":"D:\\NULLTRACE"}}

`''` is falsy, so Settings rendered its `—` placeholder forever.

## Defect 2 — the same misreading made failure look like success

Both POST helpers did `Object.assign({ ok: true, dir: target }, data)`. The literal `ok: true`
is applied **first** and the spread never overwrites it, so *every* outcome — including a
refused migration — reported success. `migrateDir` and `setDirPath` also never read the
envelope, so `migrated` and the backend's own resolved `dir` were dropped.

Both now translate through one `unwrapResult()` helper beside `apiFetch`.

## Defect 3 — the sidebar had two nested scroll containers

`.sidebar-content` sets `overflow-y: auto` **and** `.sidebar nav` set `overflow-y: auto` +
`flex: 1`. A tall footer squeezed the inner scroller; the last group came to rest below its
fold and the nav looked cut off and uneven.

Measured at 1280×800 with the bundle-result message present:

    nav      y=76  h=360  scrollH=421  clientH=360   <-- inner scroller
    Settings y=455  navBottom=436                    <-- below the fold, unreachable

The footer grew because a `.automation-api-status` message wrapped a long folder path onto
four lines. Fixed on both sides: the nav is no longer a scroll container
(`flex: 0 0 auto`, `.sidebar-content` is the single scroller), and message rows are one line
clipped with an ellipsis, full text preserved in `title`.

A third, separate cause of the garbled strip the operator saw in the collapsed rail: the
existing rule `.sidebar.collapsed .automation-api-status *:not(.status-dot)` hides only
**elements**, but message rows carry their text in a bare text node, which it cannot match.
They spilled past the 36px rail (measured `right: 294` against a rail edge at 52) and were
clipped mid-word. Those rows are now hidden outright in the rail; the header's On/Off dot is
nested a level deeper and survives.

## Files touched

- `src-tauri/src/bridge.js` — `unwrapResult()`, `getDir`, `migrateDir`, `setDirPath`
- `src/renderer/src/pages/Settings.tsx` — `onTransferFromFolder()`, transfer button in Actions
- `src/renderer/src/styles.css` — single sidebar scroller, one-line message rows, rail fix
- `src/renderer/src/components/AutomationPanel.tsx` — `title` on clipped status rows
- `src/renderer/src/i18n.tsx` — `Transfer profiles…` (ru + en)
- `tests/unit/tauriBridgeAndShell.test.ts` — envelope regression block

## Acceptance check (all executed)

| Requirement | Evidence |
|---|---|
| Current folder shows the folder in use | Bridge against live backend: `D:\NULLTRACE`; UI row renders it |
| Transfer sits beside Change Folder | Actions row: Change Folder… / Transfer profiles… / Open in Explorer |
| Failures report honestly | `setDirPath('')` → `ok:false, error:"dir is required"`; `migrateDir(same)` → `ok:false, error:"same or invalid folder"` |
| Nav reachable, one scroller | `nestedScrollers: []`, Settings y=443 inside nav bottom=485 |
| Rail cannot bleed | `bleedsPastRail: []` at width 52; only `On` visible |
| Regressions guarded | 4 new tests: red on HEAD (4 failed), green after |
| No regressions | `npm test` 132 files / 1091 passed; both typechecks exit 0 |
