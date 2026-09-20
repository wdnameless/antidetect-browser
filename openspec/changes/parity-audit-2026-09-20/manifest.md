# Requirements Manifest — parity-audit-2026-09-20

Source: user message 2026-09-20. Every requirement carries the VERBATIM words it came from.
Status: `open` | `in-spec` | `in-ticket` | `done` | `placeholder` | `deferred` | `dropped`

## Verbatim source (user's own words)

> «Смотри, я хочу, чтобы ты Провел повторный аудит сравнения нашего текущего браузера Nulltrace с shardx и Афиной и провел полный аудитбагов, который у нас сейчас есть.»

Decomposed: (a) a **re-audit** of the comparison — implying the previous one is stale and must
say what changed; (b) against **both** ShardX and Afina; (c) plus a **full bug audit** of the
current codebase. The word «повторный» makes provenance a requirement in its own right: an
audit that repeats the September findings verbatim has failed the request.

## Requirements

| # | Requirement | Verbatim quote | Status |
|---|---|---|---|
| R01 | Produce a re-audit of NullTrace vs ShardX, not a restatement of the prior analysis | «Провел повторный аудит сравнения» | done |
| R02 | Cover Afina as well as ShardX | «с shardx и Афиной» | done |
| R03 | State what CHANGED since the previous audit, with dates | «повторный» | done |
| R04 | Produce a bug audit of the current codebase | «провел полный аудитбагов» | done |
| R05 | Report current-state bugs, not historical ones | «который у нас сейчас есть» | done |
| R06 | Every competitor claim is grounded in a citable source | (audit integrity) | done |
| R07 | Every bug finding carries severity and a file:line cite | (audit integrity) | done |
| R08i | Reject claims that fail verification, and say so — a wrong finding in the queue costs more than a missing one | derived from the honesty law | done |
| R09i | Rank bugs by blast radius so the operator knows what to fix first | «полный аудитбагов» | done |
| R10i | Every citation in the audit is checked against the file, because a correct conclusion with fabricated support is not verified | derived from the honesty law | done |

## Verified facts established during this audit

- **86 commits in 8 days** (since 2026-09-12), and the architecture changed: **Electron is
  gone**, replaced by Tauri v2. `ls -d electron` → absent.
- **Artifact size fell from 260 MB to 48 MB** (portable) / 33 MB (NSIS setup) — the Tauri
  shell no longer bundles a Node/Electron runtime.
- **The update feed changed** from `latest.yml` (electron-updater) to **`latest.json`**
  (Tauri, minisign-signed). Verified live: HTTP 200, `version: 0.6.20`, three platform
  entries, each with a signature.
- **MCP exposes 47 tools** (35 tier-1 / 12 tier-2), counted three independent ways.
- **UDP ASSOCIATE already exists** (`src/main/proxy/udpRelay.ts`) — the capability Afina
  markets as its headline engine feature.
- **Engine-level stealth is NOT at parity**: 5 `TODO(engine-parity)` markers in
  `src/main/proxy/stealthInjection.ts`, and the kernel is Chromium **148** against ShardX's
  **152**.

## Bugs established by verification

| # | Severity | Summary | Status |
|---|---|---|---|
| B1 | CRITICAL | Backup restore is lost on the next DB write (in-memory `sql.js` never reloaded) | done |
| B2 | HIGH | Corrupt `settings.json` is discarded without a backup of the broken file | done |
| B3 | MEDIUM | MCP returns the full tool list and schemas with no `Authorization` header | done |
| B4 | MEDIUM | Trash purge is `SELECT`-then-loop; a concurrent restore can orphan a row | done |
| B5 | LOW | Failed spawn leaves the user-data dir for temporary profiles | done |
| B6 | MEDIUM | Compressed IPv6 targets silently become `::` in SOCKS5 UDP datagrams (found by the verifier, confirmed by measurement) | done |

## Out of scope (recorded, not scheduled)

- **Fixing the bugs.** This request is an audit («аудит»), not a fix order. The findings are
  delivered with severity and evidence so the operator chooses what to fix; the critical one
  (B1) is called out explicitly because it silently loses data.
- **Engine-level stealth work (G1–G3).** Requires patching Chromium C++ — a different class
  of work, already recorded as deferred in the parity program.
- **Rendering more ShardX/Afina detail than their public surface exposes.** Where a claim
  could not be grounded, it is marked INFERRED rather than padded.
