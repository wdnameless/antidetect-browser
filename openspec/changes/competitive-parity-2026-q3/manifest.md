# Requirements manifest — competitive-parity-2026-q3

Every row traces to the user's own words in the Wave 0 interview (2026-09-13).
Silence never cancels a row. `dropped` requires the user's own quoted words.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R01 | Deep gap analysis of ShardX + Afina vs our antidetect, listing features we lack | «Глубоко проанализируй эти проекты и сравни с нашим антиком, составь список фич которых у нас нет» | done |
| R02 | Build the plan through the T3 workflow with interactive questions | «используй т3 вокфлоу и задавай мне вопросы (интерактивно)» | done |
| R03 | Plan must lead with cheap holes across all tiers, not one big tier first | «Сначала дешёвые дыры во всех tier'ах» | done |
| R04 | Font-enumeration pinning (A2) — the largest verified stealth hole | «все» (batch 1 selection) | done |
| R05 | Mobile motion sensors (A3) — accelerometer/gyroscope/DeviceOrientation | «все» (batch 1 selection) | done |
| R06 | Automation module node (B4) must stop being a stub | «все» (batch 1 selection) | done |
| R07 | Telegram bot (C5) must be wired or removed — currently dead code | «все» (batch 1 selection) | done |
| R08 | Cookie SQLite v10/DPAPI import (C1) delivered as part of batch 1 | «все» (batch 1 selection) | done |
| R09 | XLSX import/export for profiles and proxies (C2) in batch 1 | «все» (batch 1 selection) | done |
| R10 | IMAP email manager + verification-code extraction (C3) in batch 1 | «все» (batch 1 selection) | done |
| R11 | Engine C++ patch-set is NOT in scope; JS-interim stays | «Нет — оставляем JS-interim» | deferred |
| R12 | p0f, Widevine L1, Google x-client-data stay legally gated | «Оставить отложенными» | deferred |
| R13 | Standalone SDKs for Node, Python, and Rust | «Да, Node+Python standalone» + «Только управление + CDP, плюс Rust» | in-spec |
| R14 | SDK scope is profile control + CDP endpoint only (no bundled stealth driver) | «Только управление + CDP, плюс Rust» | in-spec |
| R15 | macOS becomes the next platform | «Да, macOS следующим» | in-spec |
| R16 | macOS ships signed with Developer ID and notarized (not unsigned) | «Developer ID + notarize» | resolved-without-account |
| R17 | macOS target architecture is arm64 | «arm64» | in-spec |
| R18 | Google Drive sync is in scope | «google sync» | in-spec |
| R19 | Google Drive auth uses a user-supplied OAuth client, not ours | «Пользовательский OAuth client» | in-spec |
| R20 | Wave order: holes → data → automation → SDK → Drive → macOS | «Дыры → данные → автоматизация → SDK → Drive → macOS» | in-spec |
| R21i | Built-in SQLite manager UI (C4) was offered and not selected | «google sync» (sole selection in that question) | deferred |
| R22i | Engine-owned surfaces (WebGPU/WebAuthn CDP-V8 limits) remain JS-interim with TODO markers | «Нет — оставляем JS-interim» | deferred |
| R23i | Automation wave is authorized and scheduled after defects and data | «Дыры → данные → **автоматизация** → SDK → Drive → macOS» | in-spec |
| R24i | Live recorder: actions become flow steps; element action picker (gap B1) | «автоматизация» + gap B1 in the delivered list | in-spec |
| R25i | Fleet run view: every browser of a run with its current step (gap B2) | «автоматизация» + gap B2 in the delivered list | in-spec |
| R26i | Coherent form-filling helper, distinct identity per profile (gap B3) | «автоматизация» + gap B3 in the delivered list | in-spec |
| R27i | MCP tool surface expanded beyond the current 17 tools (gap B6) | «автоматизация» + gap B6 in the delivered list | in-spec |
| R28i | Global Variables are NOT a gap — already implemented (table `global_keys`, CRUD, AES-GCM, `app.keys.get/set` with write-back, `/api/v1/keys`, "Global Keys" UI tab). The real remaining gap is narrower: the **flow compiler cannot read them** (gap B7 corrected) | «автоматизация» + gap B7 in the delivered list; corrected 2026-09-13 after recon | in-spec |

## Deferred / not included

| ID | Item | Reason |
|---|---|---|
| R11, R22i | C++ engine patch-set (`add-engine-level-hardening` 4.1b, 7.1 remain open) | user: «Нет — оставляем JS-interim»; private engine repo/CI unavailable |
| R12 | p0f TCP spoofing, Widevine L1 pre-warm, Google `x-client-data` | user: «Оставить отложенными»; legal/protocol gate from `stealth-parity-hardening` |
| R21i | Built-in SQLite table editor + SQL terminal | not selected in the Tier D question |
| — | Google Drive **owned** OAuth client + Google verification | user chose user-supplied OAuth client instead |
| — | macOS x64 / universal2 build | user chose arm64 only |
