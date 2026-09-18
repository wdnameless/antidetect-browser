# Design — profile transfer + portable update channel

## Why the portable update is broken today (the part that decides the design)

Three facts, each verified in the tree:

1. `latest.json` publishes exactly one platform key, `windows-x86_64`, pointing at the NSIS
   **setup installer** (`scripts/build-updater-manifest.mjs`).
2. The portable `.exe` the operator double-clicks is an NSIS wrapper that sets
   `PORTABLE_EXECUTABLE_DIR=$EXEDIR` and then `Exec`s the shell it extracted under
   `%LOCALAPPDATA%\NullTrace\portable\<version>\nulltrace-tauri-shell.exe`
   (`src-tauri/windows/portable.nsi`).
3. `updater.rs::is_portable_mode()` sees that variable and routes `install()` to
   `apply_portable_update()`, which writes the downloaded bytes to `<current_exe>.new` and
   `move /Y`s them over `current_exe`.

Composing those: in the portable build, an in-app update downloads an **installer** and writes
it over the **extracted shell**. Two independent defects — wrong artefact, wrong target — and
either one alone is enough to break the build.

`current_exe()` is the extracted shell, not the launcher. The launcher is the file the operator
owns; it re-extracts on every run, so even a *correct* payload written over the extracted shell
would be discarded on the next launch. The launcher's own path must therefore be exported and
preferred as the replacement target.

## Decisions

### D1 — Channel is selected by the shell, not by the metadata consumer

The plugin already supports it: `UpdaterBuilder::target(key)` makes `get_urls()` look up exactly
that key (`tauri-plugin-updater-2.11.0/src/updater.rs`, `get_urls`). Without it, the plugin tries
`{os}-{arch}-{bundle_type}` then `{os}-{arch}` — and because the portable shell is the *same*
binary Tauri patched for the NSIS bundle, its bundle type is `nsis` and it would fall through to
`windows-x86_64`, i.e. the installer.

So: `update_channel_target()` returns `windows-x86_64-portable` when `is_portable_mode()`, else
`windows-x86_64`, and `check()` passes it to the builder. One function, one place to reason about.

*Alternative rejected:* publishing the portable artefact under `windows-x86_64`. That would hand
every installed build a 48 MB self-extracting launcher instead of an installer (and the
installer's silent-upgrade semantics) — fixing one channel by breaking the other.

### D2 — The portable channel points at the launcher, not the shell

The portable entry's URL is the portable `.exe` release asset (the whole 48 MB launcher). It is
what the operator would download by hand, and replacing it is the only action that survives the
next extraction. The extracted shell is a build artefact of the launcher, not a user-visible
file — updating it changes nothing.

### D3 — The launcher exports its own path; the updater prefers it

`portable.nsi` gains `PORTABLE_EXECUTABLE_FILE=$EXEPATH` (the electron-builder convention, so
the name is not ours to invent). `apply_portable_update()` targets that path when it is set and
exists, and falls back to `current_exe()` otherwise — which keeps the behaviour of any older
build that lacks the variable, and of non-portable runs.

The swap helper already does the right thing for this target: it waits for this process to
release its lock, `move /Y`s the staged file over the target, then `start`s it. For the launcher
that means: new launcher starts, extracts the new version to a *new* `<version>` directory, and
the app comes up as that version. The previously extracted directory is left behind and unused.

### D4 — Transfer is an import, not a relocation

The data-root relocation machinery (`movable-data-root`) moves the *whole* root and requires a
restart. The operator's problem is the opposite: the root is fine, the profiles are in the wrong
place. So transfer is a DB-level import into the live database:

- source opened read-only with `sql.js` (already a dependency, same library the scan uses);
- copy order `groups → proxies → fingerprints → devices → profiles`, so every FK row exists
  before the row that references it;
- `INSERT OR IGNORE` by primary key ⇒ an existing id is skipped, never updated (spec R10);
- a referenced row absent from the source is tolerated — the FK stays unresolved exactly as it
  is in the source;
- counts returned are the real `changes` counts, not the number of rows inspected.

Writes go through `getDb()` — the live handle — so `schedulePersist` flushes them like any other
write and the Profiles page sees them on its next read. No restart, no second database file.

*Alternative rejected:* copying the source `antidetect.db` over the destination. It would
discard every destination profile, which is the outcome the operator is trying to avoid.

### D5 — Dependency rows are copied, not re-generated

A profile's `fingerprint_id`/`device_id` point at rows carrying their `seed`/`config_json`. Those
cannot be regenerated — a different seed is a different fingerprint, which is the profile's whole
identity. They are copied verbatim, minus nothing.

## Risks

- **A stale `latest.json` cache.** A portable build that has already fetched the previous
  metadata could resolve a missing `windows-x86_64-portable` key and report `TargetsNotFound`
  ("no update"). Mitigated by publishing both keys in the same release, which is the only way
  the entry can be absent-and-referenced.
- **A large portable download (~48 MB).** Accepted: it is the artefact that actually replaces
  what the operator runs. The alternative (updating extracted files) silently reverts.
- **`PORTABLE_EXECUTABLE_FILE` is newly exported.** An older portable build updates once with
  the fallback target (the extracted shell) — harmless, since that build is then replaced and
  the next update uses the launcher. Not worth a migration path.
