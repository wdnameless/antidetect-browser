# Profile transfer and a portable-safe update

## Why

Two things the operator cannot do today, one of which is actively dangerous.

**Profiles stranded in an older data folder.** The running app uses `D:\NULLTRACE`, which holds
zero profiles. Three profiles — with their fingerprints and device records — sit in
`C:\Users\Administrator\.antidetect\data`, the location the app used before the data folder was
moved. Settings → Data Folder *finds* that folder (`Scan for existing data folders` lists it,
with the profile count) but the only action offered is **switch the working folder and
restart**. There is no way to bring those profiles into the folder already in use, so the
operator's real choice is "run out of the old folder forever" or "lose the profiles".

**The portable build would destroy itself on update.** `latest.json` publishes one entry,
`windows-x86_64`, pointing at the NSIS **setup installer**. `updater.rs::is_portable_mode()`
detects `PORTABLE_EXECUTABLE_DIR` in the portable build and takes the `apply_portable_update`
branch, which writes the downloaded bytes to `<exe>.new` and `move /Y`s them over
`nulltrace-tauri-shell.exe`. For a portable install those bytes are an installer, so an in-app
update replaces the application shell with a setup program. The operator explicitly wants to
verify updates **from inside the app**, so this path has to be correct.

## What Changes

- **Transfer action on a scan result.** Each folder found by `Scan for existing data folders`
  gains a transfer button beside the existing *Use this folder*. It imports the profiles from
  that folder into the data folder currently in use and reports what it did.
- **Merge, never overwrite.** A profile whose id already exists in the destination is skipped
  and counted, not replaced. Transferring the same folder twice is a no-op the second time.
- **Dependencies travel with the profile.** Fingerprints, devices, proxies and groups the
  transferred profiles reference are imported first, so a transferred profile can launch.
- **The list refreshes without a restart.** The transfer runs against the live database, so the
  profiles appear immediately.
- **Portable builds update from a portable artefact.** `latest.json` gains a
  `windows-x86_64-portable` entry built from the portable `.exe`, and the shell selects the
  entry matching how it was launched. An installed build keeps taking the `windows-x86_64`
  installer entry.
- **`docs/MCP.md` corrected.** Its troubleshooting row claims the bare-status defect "should not
  happen"; the explanation of how the server works is brought in line with the implementation.

## Capabilities

### New Capabilities

- `profile-transfer` — importing profiles (and their dependencies) from another data
  folder into the one in use, reporting created/skipped counts.
- `portable-update-channel` — per-bundle update channel selection: a portable build updates
  from a portable artefact, an installed build from its installer.

### Modified Capabilities

- `movable-data-root` — the existing capability covering the data-root scan and relocation.
  Its requirements gain the transfer action beside the existing switch; relocation behaviour
  is unchanged.

## Impact

- `src/main/api/routes/proxy.ts` — the scan endpoint's neighbourhood; the transfer endpoint
  belongs with data recovery.
- `src/main/db/` — reads a foreign `antidetect.db` (sql.js, same library the scan already uses).
- `src/renderer/src/pages/Settings.tsx` — a second action per scan row.
- `src/renderer/src/api.ts` — the new endpoint's client.
- `src-tauri/src/updater.rs` — channel selection in `is_portable_mode()`'s neighbourhood.
- `scripts/build-updater-manifest.mjs` — emits the portable platform entry.
- `.github/workflows/ci.yml` — passes the portable artefact to the manifest step.
- `docs/MCP.md` — corrected troubleshooting row and an explanation of the runtime.

No breaking changes: the switch-folder path, the existing `windows-x86_64` entry and every
current endpoint keep their behaviour.
