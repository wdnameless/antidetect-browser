# Tasks — competitive-parity-2026-q3

Order (user decision, R20): **defects → data → automation → SDK → Drive → macOS.**

## 1. Program governance

- [x] 1.1 Every child validated with `openspec validate <child> --strict` before implementation; umbrella validated once children exist.
- [x] 1.2 One file-owner map per wave; `src/main/api/server.ts` and `src/main/index.ts` edited only by the batch-1 integration owner.
- [x] 1.3 Every merge to `main`: full vitest suite green (baseline **97 files / 726 tests** at 2026-09-13 + child additions), `npx tsc -p tsconfig.main.json --noEmit` clean, CHANGELOG entry.
- [x] 1.4 Hygiene check that fails the build on a declared-but-unconsumed stealth option or an exported-but-unimported module (guards the defect requirement).

## 2. Wave 1 — verified defects + data formats (batch 1, parallel where zones allow)

- [x] 2.1 `add-font-pinning` (R04, defect A2): new `src/main/fingerprints/fonts.ts`; consume `StealthOptions.fontList`; hook `document.fonts`, `measureText`, canvas font probes, `queryLocalFonts`; per-family inventory from `family.fontInventory`. Tests: host font hidden, declared font measures present, phone vs desktop differ.
- [x] 2.2 `add-mobile-sensors` (R05, defect A3): `resolveSensorConfig` in `stealthNoise.ts`; hook `DeviceMotionEvent`, `DeviceOrientationEvent`, `Sensor`/`Accelerometer`/`Gyroscope`/`Magnetometer`, sensor permission query. Desktop families untouched. **Serialized after 2.1 on `stealthInjection.ts`.**
- [x] 2.3 `add-flow-module-execution` (R06, defect B4): replace the fabricated success in `compiler.ts:355-362` with a real `app.callModule` invocation against the script engine; typed error on unresolved id. Tests: invocation happens, module failure propagates.
- [x] 2.4 `add-telegram-bot-wiring` (R07, defect C5): construct `TelegramBot` at service start, bind `{start, stop, status, list, rotate}` to profile/launcher managers, fire notifications on profile status change and task-group completion, settings UI section. Tests: routing, allowlist refusal, backoff, coalescing (reuse the existing `setTelegramBotFetchSeam`).
- [x] 2.5 `add-cookie-sqlite-io` (R08, existing change 0/5): implement its approved tasks — `src/main/io/cookieSqlite.ts`, v10 + DPAPI/AES-GCM read path, merge-write keyed on `(name, host_key, path)`, refuse running profiles.
- [x] 2.6 `add-xlsx-io` (R09, existing change 0/4): implement its approved tasks — `src/main/io/xlsx.ts`, deterministic single-sheet writer, reader tolerating shared and inline strings.
- [x] 2.7 `add-email-manager` (R10, existing change 0/5): implement its approved tasks — IMAP client over TLS with injectable socket seam, code extractor, vault-backed CRUD, Email page.
- [x] 2.8 Batch-1 integration owner: mount all new routers in `server.ts`, wire startup in `index.ts`, reconcile zones, run the full suite and typecheck.

## 3. Wave 2 — automation parity (sequential on `FlowCanvas.tsx`)

- [x] 3.1 `add-flow-recorder` (R23i, B1): record pointer/keyboard actions into flow steps; right-click element action picker; compile into the existing flow document. **Owns `FlowCanvas.tsx` first.**
- [x] 3.2 `add-fleet-run-view` (B2): fleet panel showing every browser in a run with its current step, per-run log. **Serialized after 3.1 on `FlowCanvas.tsx`.**
- [x] 3.3 `add-form-filling-helper` (B3): `src/main/motion/persona.ts` — coherent person per profile (name, address, card, dates), typed through the Motion input path; each profile gets its own identity.
- [x] 3.4 `extend-mcp-tool-surface` (B6): expand `mcp/src/tools.ts` beyond 17 tools to cover proxies, extensions, flows, task groups, trash, with the existing tier/RBAC model intact.
- [x] 3.5 `add-flow-global-keys` (B7 CORRECTED): global variables already exist end-to-end (`global_keys` table, AES-256-GCM via `keyStore.ts`, `/api/v1/keys`, `app.keys.get/set` with `flushKeyWrites` write-back, "Global Keys" tab in `Scripts.tsx`) — an earlier gap claim was wrong and is withdrawn. The actual remaining gap: `compileFlowToScript` never references the key store, so a no-code flow author cannot use a global key. Scope: flow nodes can read and write global keys through the sandbox `app.keys` surface, with the same write-back semantics scripts already have.

## 4. Wave 3 — standalone SDKs (R13, R14)

- [x] 4.1 `add-sdk-node-standalone`: `ensureEngine()` (CDN fetch + ETag cache), profile create/launch/stop as subprocess, CDP endpoint return; independent CDP client connects and drives.
- [x] 4.2 `add-sdk-python-standalone`: same contract as 4.1 in Python; roundtrip parity test against the Node client's behaviour.
- [x] 4.3 `add-sdk-rust`: profile control + CDP endpoint over a Rust CDP client; no bundled stealth driver.

## 5. Wave 4 — Google Drive sync (R18, R19)

- [x] 5.1 `add-gdrive-sync`: user-supplied OAuth client identifier, Drive API scope, upload/restore of profiles, scripts and settings; Cloud Sync page section; no embedded OAuth client.

## 6. Wave 5 — macOS arm64 (R15, R16, R17)

- [x] 6.1 `add-macos-platform`: resolve engine arm64 availability first (blocking research task); make `authenticode.ts` platform-aware instead of Windows-assuming; electron-builder `mac` target on arm64, `.dmg`; entitlements plist; `secretStore` via `electron.safeStorage` (already cross-platform) verified on macOS.
- [x] 6.2 Code signing — **resolved without an Apple account.** Every arm64 binary on Apple Silicon must carry a signature (the loader refuses unsigned ARM code, independent of Gatekeeper), so "no signing at all" cannot run on an M-series Mac. `scripts/afterPack-adhoc-sign.cjs` now applies an **ad-hoc** signature (`codesign -s -`) inside-out after packing and before the dmg is built: it satisfies the loader, costs nothing, and needs no certificate. It does NOT satisfy Gatekeeper, so the documented one-time `xattr -dr com.apple.quarantine` step still applies — the same limitation the reference product documents. A Developer ID + notarization would remove that step; it is not required for the build to run. Recorded 2026-09-14.

## 7. Program closure

- [ ] 7.1 Reconcile child evidence: every child's tasks checked, tests green, CHANGELOG updated; archive children in dependency order, umbrella last.
- [ ] 7.2 Verify no defect remains: `fontList` consumed, `module` node executes, Telegram bot imported somewhere.
- [ ] 7.3 Confirm the deferred list is intact in the final report: C++ engine patch-set, p0f, Widevine, Google `x-client-data`, SQLite manager UI, macOS x64, owned Google OAuth client.

## 8. Deferred (recorded, not scheduled)

- [ ] 8.1 C++ engine patch-set — user: «Нет — оставляем JS-interim». `add-engine-level-hardening` keeps 4.1b/7.1 open; WebGPU/WebAuthn stay JS-interim with `TODO(engine-parity)` markers.
- [ ] 8.2 p0f TCP spoofing, Widevine L1 pre-warm, Google `x-client-data` — user: «Оставить отложенными»; legal/protocol gate.
- [ ] 8.3 Built-in SQLite manager UI — offered, not selected.
