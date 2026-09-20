## Why

A re-audit was requested — «повторный аудит» — which makes the audit itself the deliverable,
and makes provenance part of it: a report that restates the September findings has failed.
Two things had to be checked before anything could be written: what actually changed in the
intervening 86 commits, and which of the many plausible defects are real.

Three findings did not survive verification and are recorded as rejected, because a wrong
entry in a fix queue costs more than a missing one. Four others are real and one is critical.

## What Changes

This change produces no product code. It produces the audit and the evidence behind it:

- **The architecture changed under the previous analysis.** Electron is gone; the desktop
  shell is Tauri v2. Windows artifacts fell from 260 MB to 48 MB (portable) / 33 MB (NSIS),
  because the shell no longer bundles a Node runtime — the backend runs as a sidecar. The
  update feed changed from `latest.yml` to minisign-signed `latest.json`, verified live.

- **Two parity gaps are real and one is closed.** Engine-level stealth is not at parity: five
  `TODO(engine-parity)` markers in `src/main/proxy/stealthInjection.ts` cover signals ShardX
  patches in C++, and our kernel is Chromium 148 against their 152. Conversely, SOCKS5
  **UDP ASSOCIATE already exists** here (`src/main/proxy/udpRelay.ts`), which is the capability
  Afina markets as its headline feature.

- **One critical defect.** `restoreBackup()` replaces the database file on disk while the live
  sql.js database stays in memory. The restore reaches disk and is then overwritten by the
  next ordinary write. Reproduced end to end: after restoring a backup holding `STATE_A`, the
  file read `STATE_A`, and one subsequent write left it reading `STATE_C`. An operator who
  restores a backup and keeps working loses the restore silently.

- **Four lesser defects** with severities: a corrupt `settings.json` is discarded without
  preserving the broken file; the MCP HTTP transport returns its full tool list without an
  `Authorization` header (verified live, and state-changing calls still fail, so this is
  disclosure rather than a write hole); the trash purge can race a concurrent restore; and a
  failed temporary-profile spawn leaves an empty directory.

## Impact

- Affected specs: audit only. No product capability is added or removed by this change.
- Affected code: none. Findings are recorded for a separate fix decision.
- Evidence lives in `.workflow/recon-parity-audit-2026-09-20.md` and
  `openspec/changes/parity-audit-2026-09-20/manifest.md`.
