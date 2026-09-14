## Why

Gap analysis (2026-09-13) against ProxyShard/ShardX (patched Chromium 152 launcher, MIT, 1025★) and Afina.io (commercial antidetect, 1.5M profiles/day, 167 doc pages) produced a verified list of capabilities we lack. The findings came from their public surfaces (ShardX: README 898 lines, `openapi.yaml`, `mcp/`, `sdks/{node,python,rust}`, `runtime.json`, `docs/automation-module-example`; Afina: site + a 167-page documentation crawl) and from our own source, not our stale README.

Three findings are not "missing features" but **shipped defects** and drive the first wave:

1. **Font pinning is absent.** `fontList` is declared in `StealthOptions` (`src/main/proxy/stealthInjection.ts:36`) and consumed nowhere — there are zero font hooks in the injection. A page that enumerates fonts still sees the host machine's set. ShardX pins font enumeration at the system level.
2. **The `module` flow node is a stub.** `src/main/flows/compiler.ts:355-362` emits `{ success: true, moduleId, args }` and calls nothing. A flow that uses it silently reports success without doing work.
3. **The Telegram bot is dead code.** `src/main/telegram/bot.ts` is 296 fully-written lines imported by no file.

Mobile motion sensors (A3) are a fourth: a profile claiming a phone exposes no `DeviceMotion`/`Sensor` surface at all (zero matches in `src/`), which a single probe exposes.

This program closes those defects first, then the data-format gaps Afina has and we do not (all three already specified but unimplemented: `add-cookie-sqlite-io` 0/5, `add-xlsx-io` 0/4, `add-email-manager` 0/5), then automation parity, standalone SDKs, Google Drive sync, and macOS.

This umbrella contains no production code. It groups bounded, independently approvable and mergeable children.

## What Changes

- **Batch 1 — verified holes (parallel):** font-enumeration pinning; mobile motion-sensor surface; real `module` node execution; Telegram bot wired to the settings/notification lifecycle; cookie SQLite v10/DPAPI import; XLSX profile+proxy I/O; IMAP email manager with code extraction.
- **Batch 2 — automation parity (sequential on one file):** live recorder (actions → steps, element picker), fleet run view, coherent form-filling helper, MCP tool-surface expansion.
- **Batch 3 — standalone SDKs:** Node, Python, and Rust libraries that download the engine, launch a profile as a subprocess, and return a CDP endpoint. No bundled stealth driver; no desktop app required.
- **Batch 4 — Google Drive sync:** user-supplied OAuth client, folder-scoped backup/sync of profiles, scripts and settings.
- **Batch 5 — macOS arm64:** signed with Developer ID, notarized, packaged as `.dmg`.

Every child carries its own test requirements (repo Vitest conventions; the 601-test baseline must stay green). Children land on `main` through isolated worktrees, one file owner per slice.

## Capabilities

### New Capabilities
- `font-pinning`: profile-coherent font enumeration and measurement masking.
- `mobile-sensors`: accelerometer/gyroscope/orientation surfaces for mobile profiles.
- `flow-module-execution`: real `module` node invocation replacing the stub.
- `telegram-bot`: long-poll operator bot with command surface and outbound notifications (specified under existing `add-telegram-bot`; wiring is the delta).
- `cookie-sqlite-io`: Chromium Cookies SQLite v10 + DPAPI/AES-GCM read and merge-write (existing `add-cookie-sqlite-io`).
- `xlsx-io`: minimal OOXML workbook read/write for profiles and proxies (existing `add-xlsx-io`).
- `email-manager`: IMAP accounts, inbox read, verification-code extraction (existing `add-email-manager`).
- `flow-recorder`: recorded actions compiled into flow steps.
- `fleet-run-view`: all browsers of a run with their current step.
- `form-filling-helper`: coherent synthetic identity typed through the input engine.
- `standalone-sdk`: engine-bundling headless clients for Node, Python, Rust.
- `gdrive-sync`: user-OAuth-client Drive synchronization.
- `macos-platform`: arm64 macOS build, signed and notarized.

### Modified Capabilities
- `mcp-server`: tool surface expansion beyond the current 17 tools.
- `script-engine`: global variables for scripts.
- `parity-baseline`: adds macOS to the release matrix (Windows-first constraint relaxed by user decision).

## Impact

- `src/main/proxy/stealthInjection.ts`, `src/main/fingerprints/`, `src/main/flows/`, `src/main/telegram/`, `src/main/email/` (new), `src/main/io/` (new), `src/main/api/routes/`, `src/main/launcher/`, `src/renderer/src/pages/`, `mcp/src/`, `packages/{sdk-node,sdk-python,sdk-rust}`, `package.json` build targets.
- Tests: `tests/unit/` extensions per child; baseline **97 files / 726 tests** green at 2026-09-13.
- **Deferred (not in this program):** C++ engine patch-set, p0f, Widevine, Google `x-client-data`, built-in SQLite manager UI, macOS x64.

### Goals

- Close every verified defect before adding new surfaces.
- Give automation clients parity with ShardX's recorder/fleet/form-filler without page-visible script injection.
- Ship the three data-format gaps that already have approved specs.
- Make the product usable without the desktop app (standalone SDKs) and off Windows (macOS).

### Non-Goals

- No Chromium-from-source build farm in this program.
- No competitor profile importers, no telemetry, no Linux port in this program.
- No owned Google OAuth client and no Google verification process.

### Risks and commitments

- **A2/A3 both edit `stealthInjection.ts`** — one file owner per wave; they serialize on that file even though they are otherwise independent.
- **All flow-canvas children edit `FlowCanvas.tsx`** — batch 2 is explicitly sequential on it.
- **macOS depends on the engine's arm64 availability.** `fingerprint-chromium` publishes x64 binaries; if no arm64 build exists the child must either build it (large, out of scope here) or run the profile through a different launcher path. This child is last in the order for that reason.
- **Notarization requires an Apple Developer account ($99/yr).** Until it exists the child can produce an unsigned arm64 build and a documented `xattr` workaround, but it cannot close.
- **Google Drive with a user-supplied OAuth client has a high setup cost** for the operator (create a Cloud project, enable the Drive API, paste a client ID). Accepted by user decision.
