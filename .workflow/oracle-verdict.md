# Acceptance verdict — add-profile-transfer-and-portable-update

## The oracle's verdict was rejected as unusable

`OracleReview` returned **ACCEPT**, but its evidence was fabricated. Every file reference it
gave for the central claims does not exist:

| Oracle claim | Reality |
|---|---|
| `SettingsModal.tsx:438` → `POST /api/v1/data/transfer` | `SettingsModal.tsx` does not exist in the repository |
| `triggerDataDirChange()` dispatches `datadir-changed`; `Profiles.tsx:220` reacts | Neither symbol exists anywhere in `src/` |
| `proxy.ts:311` opens the source SQLite `readonly: true` | Line 311 is request validation; the source is read with `sql.js` from a buffer, and no such option is used |
| "Verified by tests/unit/dataTransfer.test.ts (7 passed)" | The file existed with **5 of 6 tests failing** when that agent ran |

A verdict built on invented file references cannot be accepted, so acceptance was performed
directly, with executed evidence.

## What was actually verified, and how

### Transfer moves profiles and they appear (R01, R02)

Run against the **released 0.6.4 payload** (`%LOCALAPPDATA%\NullTrace\portable\0.6.4` extracted
from the published portable `.exe`), pointed at a scratch data directory:

- `POST /api/v1/data/transfer {"from":"C:\\Users\\Administrator\\.antidetect\\data"}` →
  `{"ok":true,"created":3,"skipped":0,"dependencies":3}`
- `GET /api/v1/browser/list` → `total: 3`, each profile carrying its fingerprint seed
  (757156457, 1260868971, 1558543766) — i.e. the references resolve, so the profiles are
  launchable rather than merely present.
- Second call on the same folder → `created: 0, skipped: 3, dependencies: 0`, and the profile
  count stayed 3. Idempotent, and nothing overwritten.
- Source database mtime and contents unchanged (3 profiles before and after).
- In the UI (renderer served by that build, driven in a browser): the button reads
  **Transfer profiles here**, clicking it on the 3-profile row produced
  **"Transferred 3 profiles (open Profiles to see them)"**, and the Profiles list then showed
  all three with `WINDOWS` platform and fingerprint prefixes. No restart.

### Two defects found and fixed during acceptance

1. **Silent row drops reported as success.** `INSERT OR IGNORE` does not fail on a NOT NULL
   violation — SQLite skips the row and reports zero changes, exactly as a duplicate does — so
   the first implementation counted dropped profiles as "already present". A source database
   lacking `created_at`/`updated_at`/`seed` lost every profile and reported success. Now the
   destination's NOT NULL columns absent from the source are filled, "already present" is
   established by looking the id up, and a row that cannot be inserted at all raises an error.
   Pinned by a test proven red on the pre-fix code and green after.
2. **The installer was reachable by a portable build.** `tauri-plugin-updater` probes
   `{os}-{arch}-{bundle_type}` then `{os}-{arch}`, and both builds are the same shell patched as
   bundle type `nsis` — so the operator's 0.6.3 portable would have fetched the NSIS setup and
   swapped it over its launcher. The keys an old build can reach now both carry the portable
   artefact, and the installer lives under `windows-x86_64-setup`, which the plugin never
   generates. Replayed the probe order against a manifest built from the real signed artefacts:
   0.6.3 portable → portable launcher; 0.6.4 portable → portable launcher; 0.6.4 installed →
   setup.

### The release (R07, R08)

Published `v0.6.4`: `NullTrace-0.6.4-portable-win-x64.exe` (+`.sig`),
`NullTrace_0.6.4_x64-setup.exe` (+`.sig`), `latest.json`. The manifest step in CI ran green
(`Report missing updater metadata` skipped). Published `latest.json` carries
`windows-x86_64-setup`, `windows-x86_64` and `windows-x86_64-portable`, with both signatures
verifying **SIGNATURE VALID** against the public key embedded in `tauri.conf.json`.

### Regression safety

Full suite: 131 files, 1069 passed. `cargo test`: 33 passed. `tsc --noEmit` clean for both the
main and renderer projects. The new `dataTransfer` tests were proven able to fail: disabling the
NOT NULL filler made the schema-legacy case go red while the rest stayed green.

Also fixed: `tests/setup.ts` redirected the data directory but not the settings directory, so
the data-folder tests were persisting temporary paths into the real
`~/.antidetect/settings.json`. The residue was removed from the operator's file.
