# Requirements manifest — android-emulator-integration

Every row traces to the operator's own words (2026-09-19). `i`-suffix = implicit
requirement surfaced by the interview. Silence never cancels a row.

Verbatim sources in this session:

- Interview options the operator selected (Wave 0 `ask` widget):
  - «On-demand Downloader (Рекомендуется)»
  - «Встроенный Canvas (WebCodecs / scrcpy) (Рекомендуется)»
  - «AOSP + Zygisk/Magisk + tun2socks (Рекомендуется)»
  - «Windows-first с кроссплатформенным ядром (Рекомендуется)»
- «Приступай к реализации» — the build order.
- Prior recorded instruction: «Архитектурные решения и системные дизайны должны быть формализованы
  в comprehensive Markdown спецификации, хранящиеся прямо в репозитории
  (e.g. `docs/ANDROID_EMULATOR_ARCHITECTURE.md`), структурированные в явные последовательные
  этапы реализации».
- Prior recorded instruction: «Open-Source Research Prior to Custom Builds» — audit existing
  solutions before writing proprietary code.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R01 | The Android runtime is the headless Google AOSP QEMU emulator launched with no native window | interview → `Встроенный...` + arch doc §1 | in-spec |
| R02 | Emulator binaries and the base system image are **downloaded on demand**, not bundled; the installer stays small | user chose «On-demand Downloader» | in-spec |
| R03 | Every downloaded artifact is integrity-checked (SHA-256 preferred; SHA-1 where that is all the vendor publishes — Google's emulator/system-image feeds) and fails closed on mismatch | repo precedent `kernelAcquire.ts` + R02 | in-spec |
| R04 | The Android screen is rendered **inside the app UI** on an HTML5 canvas, H.264 decoded via WebCodecs over the scrcpy protocol — no native OS window embedding | user chose «Встроенный Canvas (WebCodecs / scrcpy)» | in-spec |
| R05 | Mouse events map to Android touch events (click, drag/swipe, scroll) and the operator gets hardware nav buttons (Back, Home, Recents, Power, Rotate) | arch doc §3.2; implied by R04 | in-spec |
| R06 | A profile can be of type `desktop` (existing) or `android`; the existing desktop path is untouched | `Приступай к реализации` on the frozen arch doc §4 Этап 3 | in-spec |
| R07 | Each Android profile has isolated writable state (Copy-on-Write `userdata`) over a shared read-only base image | arch doc §3.1; `i`-suffix (isolation is the product's core promise) | in-spec |
| R08 | Mobile hardware identity is spoofed on the guest: `build.prop` fields, Android ID, IMEI, MAC, serial | user chose «AOSP + Zygisk/Magisk + tun2socks» | in-spec |
| R09 | Emulator fingerprints (goldfish/qemu artifacts) are hidden so Play Integrity / SafetyNet-style checks do not trivially flag the guest | user chose «AOSP + Zygisk/Magisk + tun2socks» | in-spec |
| R10 | **All** guest traffic is forced through the profile's proxy (TCP and UDP, DNS included) — no direct leak | user chose «tun2socks», arch doc §3.4 | in-spec |
| R11 | GPS coordinates given to the guest are derived from the profile's proxy geolocation | arch doc §3.3; `i`-suffix (proxy+geo coherence already a repo invariant) | in-spec |
| R12 | Android is built and verified on Windows first; macOS (HVF, arm64) and Linux (KVM) are resolved by the same code path, not stubbed | user chose «Windows-first с кроссплатформенным ядром» | in-spec |
| R13 | Missing prerequisites (hypervisor disabled, no download yet) produce an actionable error, never a silent failure | repo convention (`KernelAcquireError` codes) | in-spec |
| R14 | The operator can start, stop, and observe an Android profile through the same profile API surface as a desktop profile | `Приступай к реализации`; existing profile routes are the contract | in-spec |
| R15 | Structural work refreshes `.archmap/architecture.html`; no new dependency cycles | AGENTS.md §1b | in-spec |
| R16 | The architecture is formalized as a Markdown spec in the repo, split into sequential stages | recorded prior instruction; `docs/ANDROID_EMULATOR_ARCHITECTURE.md` | done |
| R17 | Existing open-source tooling is audited before proprietary code is written — scrcpy (`@yume-chan/scrcpy` protocol) and the AOSP emulator itself are the reused components | recorded prior instruction | in-spec |
| R18 | The desktop (Chromium/Stealth) launch path must not regress: all 146 existing tests stay green | repo invariant; `i`-suffix | in-spec |
