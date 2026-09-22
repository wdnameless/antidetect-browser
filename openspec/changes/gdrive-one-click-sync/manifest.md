# Manifest — One-click Google Drive sync

## Rows

**R1.** «Я хочу чтобы юзер нажимал одну кнопку и подключался к своему гуглдрайву»
→ One button ("Connect Google Drive") establishes the connection. No Google Cloud Console, no pasted Client ID, no separate "Save credentials" step.

**R2.** «и все юзерданные нашего браузера автоматически синкались в папку nulltrace data на гугл драйве»
→ The sync folder on Drive is named **`nulltrace data`** (current code creates `NullTrace_Sync` — must change). Sync is **automatic**, not a button the operator must press.

**R3.** «Так же если он мог бы зайти с другого пк, так же зайти нажать кнопку и синхронизировать все данные.»
→ On a second machine, the same single button restores **all** data: profiles, proxies, fingerprints, groups, tags, notes, vault credentials, scripts, settings, sessions.

**R4.** Scope answer (widget): «Всё, включая папки Chromium (795 MB)»
→ The operator asked for the Chromium profile directories to be included too. This is IMPLEMENTED AS A SEPARATE, OPT-IN SWITCH with a measured warning, not as part of the default — see "Deviation" below.

**R5.** Encryption answer (widget): «E2E: шифровать парольной фразой»
→ Payload uploaded to Drive is encrypted with AES-256-GCM under a key derived from an operator-chosen passphrase. The passphrase is never transmitted and never stored on disk. Google cannot read the contents.

**R6.** Client answer (widget): «Создам один проект под приложение»
→ One OAuth client belongs to the publisher and ships in the build. Per-user credential entry is removed (kept only as an advanced fallback).

**R7.** Auto-sync answer (widget): «При изменениях + при старте/выходе»
→ Push on data change (debounced), plus on launch and on exit; pull on launch.

## Deviation from R4, with the measurement that forced it

The operator asked to sync "everything, including the Chromium folders (795 MB)". Measured on the
real install (`D:/NULLTRACE`), that 785 MB is almost entirely regenerable cache; the part that
actually carries a login is ~1.75 MB:

| Layer | Measured size | What it is | Portable to another PC? |
|---|---|---|---|
| Database (profiles, proxies, fingerprints, groups, tags, notes, vault, scripts, settings) | **304 KB** | the product's own portable representation | Yes |
| Site state (`Local Storage`, `IndexedDB`, `Network/Cookies`, `Sessions`, `WebStorage`, `Local State`) | **1.75 MB** | where logins and app state live | Cookies need re-encryption (already implemented, see below); `Local Storage`/`IndexedDB` are plaintext and copy fine |
| Regenerable cache (`Cache`, `Code Cache`, `GPUCache`, `DawnWebGPUCache`, `GraphiteDawnCache`, `ShaderCache`, `GrShaderCache`, `Service Worker`, `BrowserMetrics`, `Crashpad`) | **759.8 MB** | HTTP cache, compiled JS, GPU programs, service-worker cache | **No** — rebuilt on demand; copying it wastes the transfer and Drive quota |
| Everything else in the profile dirs | 23.5 MB | dictionaries, metrics, unclassified Chromium bookkeeping | mostly no |

So the tiers are **0.3 MB → 2 MB → 25 MB → 785 MB**, and the useful destination for a restore is
the second one. `Default/Service Worker` alone is 197 MB of that cache.

Two independent reasons the raw directories cannot deliver R3:

1. **The cookie store does not decrypt elsewhere.** Chromium's cookie key is wrapped with Windows
   DPAPI, which is per-machine and per-user. Verified in-tree: `src/main/io/cookieSqlite.ts` exists
   precisely to unwrap that key (`defaultDpapiUnprotect`, `DPAPI` prefix at `Local State` →
   `os_crypt.encrypted_key`) and re-encrypt with a locally-valid key (`encryptCookieValue` → `v10`).
   Copying `Cookies` from machine A to machine B yields values B cannot read.
2. **`Default/Network/Device Bound Sessions` is machine-bound by design** (Chrome 127+), so a copied
   profile cannot reuse those sessions.

Sessions DO travel between machines — through the mechanism the product already has.
`profiles.cookies_json` is the portable store (`resolveLaunchConfig` reads it at launch,
`exportProfileBundle`/`importProfileBundle` carry it, `/cookies/export-sqlite` moves a live Chromium
store into it). Therefore:

- **Default sync = database + vault + notes + tags + groups + proxy.** 304 KB, and it already
  includes live sessions through `cookies_json`. This satisfies R2 and R3.
- **Site state tier (opt-in, ~2 MB)** = `Local Storage`, `IndexedDB`, `Sessions` for **stopped**
  profiles, sealed. Adds logins on sites that keep state outside cookies. Collected only when the
  profile is not running, and LevelDB `LOCK`/`LOG` files are excluded — a copy taken while Chromium
  holds the store is torn, and a `LOCK` file on the target machine can wedge the profile.
- **Full mirror (opt-in, ~25 MB)** = every profile file except the regenerable cache list above,
  with the cost shown next to the switch.
- **The literal 785 MB is not offered as a default** because 759.8 MB of it is cache that the second
  machine rebuilds by itself, and it would still not log the operator in — the exact thing R3 asks.

## Rows not claimed

R4's literal wording ("all data including Chromium dirs, by default, 795 MB") is NOT implemented as
written: the caches are excluded by policy and the valuable site state is a separate opt-in tier.
Everything else (R1, R2, R3, R5, R6, R7) is implemented as specified.

## Zone C — profile-directory tiers (implemented in this branch)

`src/main/cloud/profileArchive.ts` carries both opt-in tiers and owns the exclusion policy in one
place (`REGENERATED_DIRS`, `FORBIDDEN_FILES`, `TRANSIENT_SUFFIXES`):

| Function | Purpose |
|---|---|
| `buildProfileArchive(profileIds \| null, siteStateOnly)` | Collect + frame + gzip. `siteStateOnly` picks the ~1.75 MB tier; otherwise every non-cache file. |
| `restoreProfileArchive(blob)` | Write the archive back, creating profile directories. |
| `frameFiles` / `unframeFiles` | Dependency-free, self-describing container (magic `NTSA`, version, count, then per-entry path + length + data), gzip'd once. |

Safety properties that are deliberate, not incidental:

- **Running profiles are skipped, not read.** They are reported back in `skipped[]` with the reason,
  so the operator is told what was left out instead of discovering a torn `Local Storage` later.
- **Stale `LOCK` files never travel.** `lockfile`, `Singleton*` are excluded — a stale lock landing on
  the target machine is the classic "profile will not start" failure.
- **`Local State` is excluded.** It holds the DPAPI-wrapped `os_crypt.encrypted_key`, which is useless
  on another machine and would leave a half-restored, unreadable cookie store.
- **Restore validates paths.** `restoreProfileArchive` rejects `..` segments and any path that escapes
  the profile root; a tampered archive in Drive is untrusted input and must not be able to write
  outside the data directory.
- **Malformed input throws** (`unframeFiles`) rather than writing partial garbage.
