# Requirements manifest — nulltrace-portable

Every row traces to the user's own words (2026-09-14). Silence never cancels a row.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R41 | No installer — the browser launches as a single file | «Я не хочу чтобы был установщик, хочу чтобы наш бразуер запускался одним файлов» | in-spec |
| R42 | Portable build for all systems | «portable версия, под все системы» | in-spec |
| R43 | Windows: single-file portable executable | user chose «Electron portable (.exe, самораспаковка)» | in-spec |
| R44 | Linux: single-file AppImage | user chose «Win portable + Linux AppImage + macOS dmg (как ShardX)» | in-spec |
| R45 | macOS: .dmg (noted as NOT portable, matching ShardX) | same selection; ShardX's own macOS build is a .dmg requiring drag-to-Applications | in-spec |
| R46 | The browser kernel is NOT bundled — fetched on first run | user chose «Скачивать при первом запуске (нужен CDN)» | in-spec |
| R47 | Kernel is fetched from the upstream GitHub Releases, not a new CDN | user chose «Тянуть с GitHub Releases апстрима (сейчас)» | in-spec |
| R48 | Secrets keep using Electron safeStorage/DPAPI | user chose «Оставить Electron — секреты не трогаем» | in-spec |
| R49 | Portable data location is chosen on first run | user chose «Спрашивать при первом запуске» | in-spec |
| R50 | Delivery through a PR from the current branch, with CI building all three platforms | user chose «PR из fix/ci-pipeline (рекомендую)» | in-spec |
| R51i | The monochrome noir redesign runs AFTER portability | user chose «Сначала портатив, дизайн потом» | deferred |
| R52i | An embedded kernel fallback was offered and NOT chosen | user chose CDN fetch over «Вшить в файл (500 МБ, но автономно)» | dropped |

## Hard constraint

R41 says "no installer". `electron-builder`'s `portable` target produces a
self-extracting single `.exe` — the user runs that one file and nothing is
installed. It is NOT the same as `nsis`, which is the current target and IS an
installer. Both must not ship; the portable artefact replaces it.

## Known limits recorded up front

- macOS genuinely cannot be single-file. ShardX ships a `.dmg` and documents an
  `xattr` step because it has no Apple Developer ID. We have no Apple account
  either, so the same limitation applies and is stated rather than hidden.
- Linux and macOS artefacts cannot be built on this Windows host — they require
  their own operating systems, so CI is the only path (R50).
