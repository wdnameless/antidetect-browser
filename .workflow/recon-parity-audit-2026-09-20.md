# Recon — competitive re-audit and bug audit (2026-09-20)

T2 recon artifact. Every claim below was verified by the orchestrator against the code or the
live service; agent reports were treated as claims and checked, three of which were wrong.

## 1. What changed since the 2026-09-12 analysis

86 commits in 8 days. The important structural change: **the Electron shell is gone.**

| Area | 2026-09-12 | now (HEAD 995263f, v0.6.20) |
|---|---|---|
| Desktop shell | Electron (`electron/`) | **Tauri v2 only** — `electron/` no longer exists |
| Windows artifact | 260 MB portable `.exe` | **48 MB portable + 33 MB NSIS setup** |
| Update feed | `latest.yml` (electron-updater) | **`latest.json`** (Tauri updater, minisign-signed) |
| Release metadata | absent until v0.5.0 | `latest.json` + `.sig` per artifact, verified present |
| MCP tools | 47 | **47** (was claimed 52 by an agent — see corrections) |

The size drop from 260 MB → 48 MB is the headline: the Tauri shell no longer ships a
bundled Node/Electron runtime; the Node backend runs as a sidecar.

## 2. NullTrace capability inventory (verified from `src/main/api/server.ts`)

27 route groups mounted. Feature areas that exist **in code**, with the route that proves it:

- **Profiles/groups** `/api/v1/profiles`, `/groups`, `/trash`, `/workspaces`
- **Fingerprints** `/api/v1/fingerprints` — seed-based deterministic model
  (`src/main/fingerprints/`): canvas 2D CRC32-seeded noise, WebGL vendor/renderer,
  platform font sets, audio jitter, WebRTC, screen, Client Hints.
- **Proxy** `/api/v1/proxies` with **UDP ASSOCIATE support already present** —
  `src/main/proxy/udpRelay.ts`, `transportPolicy.ts`, `proxyHealth.ts`
  (`udp-associate-refused` classification). This is the capability Afina markets as its
  headline engine feature; we have a working implementation.
- **Automation** `/api/v1/flows`, `/scripts`, `/tasks`, `/calendar` + `FlowCanvas.tsx`
- **MCP** `mcp/` — 47 tools, 35 tier-1 / 12 tier-2 (counted three ways)
- **Cloud/sync** `/api/v1/cloud`, `/sync` (Google Drive) + standalone `packages/sync-server`
- **Teams** `/api/v1/teams`, **Email** `/api/v1/email`, **Telegram** `/api/v1/telegram`
- **Security/licensing** `/api/v1/security`, `/license`; snapshots, storage
- WebSockets `/terminal`, `/cdp-proxy`

## 3. Verified parity gaps (where competitors are ahead)

| # | Gap | Our state | Their state | Evidence |
|---|---|---|---|---|
| G1 | **Engine-level stealth** | 5 `TODO(engine-parity)` markers in `src/main/proxy/stealthInjection.ts` — JS shims for `Function.prototype.toString`, `userAgentData`, `window.chrome.runtime`, `chrome.webstore`, `Navigator.prototype.platform` | ShardX patches Blink/V8/network in C++ (`README`, `runtime.json`) | grep of `TODO(engine-parity)` |
| G2 | **Kernel version** | Chromium **148.0.7778.215** (`scripts/ensure-kernel.mjs:14`) | ShardX: Chromium **152** | both pinned in code |
| G3 | **TLS ClientHello / JA4** | not patched in the engine | ShardX shuffles ciphers/sig-algs to match Chrome 152 (`runtime.json`) | ShardX repo |
| G4 | **Fingerprint preset library** | profiles derive per-profile, no large curated library | ShardX ships **220 CDN presets** (Mac M1–M5, Win RTX/GTX/Intel/AMD, Linux, Android) | ShardX `fingerprints.rs` |
| G5 | **Zero-knowledge vault** | `secretStore` uses OS keychain / `plain:` fallback | Afina: master-password-derived device key, `sealedBox` before disk/cloud | Afina `/zero-knowledge` |
| G6 | **Web3/wallet automation** | none | Afina: Rabby login + popup interception blocks | Afina blog |
| G7 | **Team seats model** | `/api/v1/teams` exists; no published seat pricing | Afina sells 2/5/10 seats across tiers | Afina `/plan` |

## 4. Where NullTrace is ahead

- **Vastly more features in one build**: 27 API groups incl. email, calendar, Telegram,
  licensing, snapshots, trash with retention — ShardX's public repo has no team/cloud sync
  at all (pure local filesystem), and Afina has no Linux build.
- **Linux support** (ShardX: Windows-focused; Afina: explicitly none).
- **Local data ownership**: no mandatory cloud; Afina's team features require their cloud.

## 5. Bug audit — verified findings

Ranked by blast radius. Severity reflects **my** verification, not the reporter's.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| B1 | **CRITICAL** | **Backup restore silently loses the restored data.** `restoreBackup()` swaps the DB file on disk, but the live DB is `sql.js` held **in memory**; any later write runs the debounced `persistNow()` and overwrites the freshly restored file with the stale in-memory state. The endpoint returns `restart_required: true`, but that is advice, not enforcement. **Reproduced end to end**, not inferred: with a backup holding `STATE_A`, the file read `STATE_A` immediately after restore and `STATE_C` after one ordinary write. The UI makes this worse — Settings offers a "Database Backups (restore)" panel whose own text promises «the operation is reversible», so the operator is told the opposite of what happens. | `src/main/util/backupManager.ts:37-55`, `src/main/db/index.ts:50,68-89,95-125`, `src/main/api/routes/proxy.ts:852-863`, `src/renderer/src/pages/Settings.tsx:1008-1010`, probe run 2026-09-20 |
| B2 | **HIGH** | Corrupt `settings.json` falls back to `{}` with **no backup of the broken file**, and the next write persists defaults — silently erasing the operator's data-dir choice, ports and paths. | `src/main/config.ts:55-78` (no `copyFile`/`.bak`) |
| B3 | **MEDIUM** | MCP HTTP returns the **full tool list and schemas without any Authorization header**. Verified live: `tools/list` returned 47 tools with no token. State-changing calls still fail (the tool's own API call 401s, verified: `profiles.create` → `unauthorized`), so this is information disclosure, not a write hole — milder than reported. | `mcp/src/server.ts:196-210`; live test on port 40777 |
| B4 | **MEDIUM** | Trash purge is a `SELECT` then loop of deletes; a concurrent `restoreProfile` between them can leave a row restored whose data directory was deleted. | `src/main/profiles/profileManager.ts:829-839` |
| B5 | **LOW** | A failed `spawn` throws **after** `mkdirSync(cfg.userDataDir)`; the directory is only removed on the normal-exit path and only for temporary profiles. Repeated failures of temporary launches leave empty dirs. | `src/main/launcher/chromium.ts:454,610,808` |
| B6 | **MEDIUM** | **Compressed IPv6 targets silently become `::` in SOCKS5 UDP datagrams.** The encoder strips colons and hex-decodes: `targetHost.replace(/:/g, '')`. That only yields 16 bytes for a fully-expanded address. For `::1`, `fe80::1` or `2001:db8::1` it produces 0–4 bytes, and the `else` branch then writes **sixteen zero bytes** — the packet is addressed to `::` instead of the requested host, with no error raised. Measured: `::1` → 0 bytes, `2001:db8::1` → 4 bytes, `fe80::1` → 2 bytes, only the fully expanded form is correct. | `src/main/proxy/udpRelay.ts:182-190`; measured with node on 2026-09-20 |

### Claims I checked and REJECTED

Four agent findings did not survive verification and must not enter the fix queue:

- **"52 MCP tools"** — the manifest contains **47** (counted by grep, by compiled module, and
  by the live `/api/v1/mcp/status` endpoint).
- **"Decrypted proxy passwords are returned to the renderer"** — false. The list handler at
  `src/main/api/routes/proxy.ts:49-61` enumerates its fields explicitly and `password` is not
  among them.
- **"The Tauri sidecar trusts any listener on 50325"** — inverts reality. `src-tauri/src/sidecar.rs`
  documents and fixes exactly this: readiness now requires the backend's own "bound" log line,
  and the code comments record that the old port-probe approach served a stale build.
- **"Profile directory hard deletion can hit a running browser"** — false. `deleteProfile`
  (`src/main/profiles/profileManager.ts:760-770`) is a **soft delete**: it sets `deleted_at`
  and status `closed` and leaves the user-data directory on disk, so no live browser's files
  are unlinked. Permanent removal only happens through the trash purge path (B4).

## 6. Acceptance check for this recon

- Claim "Tauri only": `ls -d electron` → absent; `scripts.tauri*` present. ✓
- Claim "47 tools": three independent counts agree. ✓
- Claim "B1 loses data": read `backupManager` + `db/index.ts` persist path; the in-memory
  state is never reloaded after restore. ✓
- Claim "B3 is info-only": live unauthenticated `tools/list` succeeded, live unauthenticated
  `profiles.create` failed. ✓
- Claim "B6 mangles IPv6": measured with node — `::1` → 0 bytes, `fe80::1` → 2 bytes,
  `2001:db8::1` → 4 bytes, all silently falling back to an all-zero `::`. ✓

## 7. Independent verification of THIS audit

A blind verifier was given this report and asked to falsify it. Verdict: **ACCEPT** on all
eight checks, with one finding this audit had missed (B6, now included above). Its conclusion
was right, but **four of its supporting citations were fabricated**, which is worth recording
because the pattern recurs:

| Verifier citation | What is actually there |
|---|---|
| "artifacts 50 076 827 / 34 717 665 bytes" | measured 33 147 490 (setup) and 48 747 718 (portable) — the pair is swapped |
| "`proxy.ts:51` masks password as `'********'`" | the file contains **zero** occurrences of `****`; line 51 is `proxy_id: p.id` |
| "`profileManager.ts:756` checks `isProfileRunning(id)`" | line 756 is the end of `toResult` |
| "`sidecar.rs:328` injects a random 32-byte api-key" | line 328 is `ready_clone.store(true, Ordering::SeqCst)` |

The rejection verdicts themselves were correct — verified independently here — but the
evidence offered for them was invented. **A correct conclusion with fabricated support is not
a verified claim**, and this is why every citation in sections 2–5 above was checked against
the file rather than accepted from a report.
