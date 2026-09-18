# Tasks — profile transfer + portable update channel

## 1. Backend: transfer endpoint

- [ ] 1.1 `POST /api/v1/data/transfer` in `src/main/api/routes/proxy.ts` (beside the existing scan), body `{ from }`, standard envelope, `TransferResult` shape from `interfaces.md` §A
- [ ] 1.2 Refuse `from` == folder in use with `code: -1`; refuse a missing/unreadable/corrupt source database with a stated error and `created: 0`
- [ ] 1.3 Open the source with `sql.js` read-only; never write to it
- [ ] 1.4 Import in FK order `groups → proxies → fingerprints → devices → profiles` using `INSERT OR IGNORE` so an existing destination id is skipped, never updated
- [ ] 1.5 Tolerate a referenced row absent from the source (leave the FK unresolved, do not count the profile as skipped)
- [ ] 1.6 Return real `created`/`skipped`/`dependencies` counts taken from the write results
- [ ] 1.7 Unit test: transfer into an empty destination creates every profile and its dependencies; second transfer creates nothing; a local edit survives; a missing source errors

## 2. Renderer: the transfer action

- [ ] 2.1 `dataTransfer(from)` in `src/renderer/src/api.ts` (`interfaces.md` §B)
- [ ] 2.2 `Transfer profiles here` button per scan row in Settings → Recover old data, beside the existing `Use this folder`
- [ ] 2.3 Enabled only for a non-current folder with `profiles > 0`; busy state reads `Transferring…`
- [ ] 2.4 Report the real outcome: `transferred N profile(s)` from `created`, `M already present` when `skipped > 0`, the returned `error` on failure
- [ ] 2.5 Russian strings added to `i18n.tsx` for every new label
- [ ] 2.6 Verified in the running app: the three profiles from `C:\Users\Administrator\.antidetect\data` appear in the Profiles list

## 3. Updater: portable channel

- [ ] 3.1 `update_channel_target()` in `src-tauri/src/updater.rs` → `windows-x86_64-portable` when `is_portable_mode()`, else `windows-x86_64`
- [ ] 3.2 `check()` passes it via `UpdaterBuilder::target(..)` so the plugin resolves exactly that key
- [ ] 3.3 `portable.nsi` exports `PORTABLE_EXECUTABLE_FILE=$EXEPATH`
- [ ] 3.4 `apply_portable_update()` targets `PORTABLE_EXECUTABLE_FILE` when set and present, else falls back to `current_exe()`
- [ ] 3.5 Rust tests: channel selection for both modes; target preference and fallback
- [ ] 3.6 `build-updater-manifest.mjs` accepts `--portable-artefact`/`--portable-url`, emits `windows-x86_64-portable`, omits the entry when the artefact is absent, still refuses an empty signature
- [ ] 3.7 Release job in `.github/workflows/ci.yml` passes the portable artefact and its URL

## 4. Docs

- [ ] 4.1 `docs/MCP.md`: correct the stale troubleshooting row; describe the panel↔endpoint contract
- [ ] 4.2 `CHANGELOG.md` entry for the release

## 5. Release

- [ ] 5.1 Version bump to `0.6.4` (`package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`)
- [ ] 5.2 Full suite + typecheck green; portable rebuilt and its icon frames re-verified
- [ ] 5.3 Tag pushed; release job publishes `latest.json` with BOTH platform entries
- [ ] 5.4 Verify the published `latest.json` resolves the portable entry for a portable build, and that both signatures verify
- [ ] 5.5 Download the new artefacts to the Desktop
