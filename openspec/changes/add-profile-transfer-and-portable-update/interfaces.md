# Interfaces — profile transfer + portable update channel

Frozen before Wave 3. Each worker implements against these signatures; nobody invents a
different shape for the same boundary.

Owner of this file: orchestrator (nobody else writes it).

---

## A. Transfer endpoint (owner: backend worker)

`POST /api/v1/data/transfer` — body `{ from: string }`, authenticated like every other
`/api/v1` route (Bearer).

Response is the standard envelope (`docs/API_CONTRACT.md`), `data` shaped:

```ts
interface TransferResult {
  ok: boolean;
  /** Absolute path of the source folder, resolved. */
  from: string;
  /** Profiles written into the data folder in use. */
  created: number;
  /** Profiles already present in the destination, left untouched. */
  skipped: number;
  /** Dependency rows written (fingerprints + devices + proxies + groups), for the report. */
  dependencies: number;
  /** Present only when ok is false. */
  error?: string;
}
```

Rules the implementation MUST honour (these are the spec's scenarios):

- `from` resolved and compared to the folder in use → identical is `code: -1` with
  `'source is the data folder in use'`.
- Source `antidetect.db` missing/unreadable/corrupt → `code: -1`, a stated error, `created: 0`.
- Reads the source with `sql.js` (already a dependency; `routes/proxy.ts` uses the same
  library for the scan).
- Imports, in order: **groups → proxies → fingerprints → devices → profiles**. A profile's
  FK row must exist before the profile row.
- A profile whose `id` exists in the destination is skipped, never updated.
- A referenced row missing from the source is not an error — the reference stays unresolved.
- Writes only to the database in use; the source file is opened read-only and never written.
- The destination's own rows are never modified (no upsert, no overwrite).

## B. Renderer client (owner: backend worker, consumed by UI worker)

`src/renderer/src/api.ts`:

```ts
dataTransfer: (from: string) =>
  request<{ ok: boolean; from: string; created: number; skipped: number; dependencies: number; error?: string }>(
    '/api/v1/data/transfer',
    { method: 'POST', body: JSON.stringify({ from }) }
  ),
```

## C. Settings UI (owner: UI worker)

One new action per scan row in the **Recover old data** block, beside the existing
`Use this folder`:

- Label: `t('Transfer profiles here')`.
- Enabled only when `f.profiles > 0` AND `!f.isCurrent` (the list already filters `isCurrent`).
- On success shows `Transfer profiles here` → `transferred N profile(s)` using the returned
  `created`, plus `, M already present` when `skipped > 0`.
- On failure shows the returned `error` — never a bare "failed".
- While running, the button is disabled and reads `t('Transferring…')`.
- After a successful transfer the app MUST reflect the new profiles without a restart. The
  Profiles page re-reads on mount/visibility-change, so the UI worker MUST NOT add a global
  refresh bus: the operator switching to Profiles is enough. If the transfer created rows,
  the message MUST say so plainly (`transferred N profile(s) — open Profiles to see them`).

## D. Update channel (owner: updater worker)

`src-tauri/src/updater.rs`:

- A function returning the platform key this build must resolve, e.g.
  `pub fn update_channel_target() -> String` → `"windows-x86_64-portable"` when
  `is_portable_mode()`, else `"windows-x86_64"`.
- `check()` MUST pass that key via `UpdaterBuilder::target(..)` so the plugin searches only
  that entry (`updater.rs` in the plugin: `get_urls` tries `{target}` first when set).
- The chosen key MUST be the same string `latest.json` publishes — a mismatch is
  `TargetsNotFound` and reads as "no update", which is the bug class this change fixes.

`scripts/build-updater-manifest.mjs`:

- Accepts an optional `--portable-artefact <path>` and `--portable-url <url>`.
- Emits `platforms['windows-x86_64']` (installer) and, when the portable artefact exists,
  `platforms['windows-x86_64-portable']`, each signed with its own `.sig`.
- The portable entry is omitted — never invented — when the artefact is absent (spec R).
- Refuses to emit an entry whose `.sig` is missing or empty, as it already does.

`.github/workflows/ci.yml` (release job):

- Passes the portable artefact + its release URL to the manifest step.

## E. Docs (owner: orchestrator)

- `docs/MCP.md`: replace the stale troubleshooting row that claims the bare-status defect
  "should not happen"; state what the panel reads and what a mismatch looks like.
