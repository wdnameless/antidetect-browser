# Requirements Manifest — shardx-shell-and-automation

Source: user message 2026-09-14, with three reference screenshots (NullTrace current, ShardX
Launcher v2.0.3, NullTrace Automation).
Status: `open` | `in-spec` | `in-ticket` | `done` | `placeholder` | `deferred` | `dropped`

## Verbatim source (user's own words)

> «Хочу чтобы нас интерфейс выголядил вот так, шрифты, разделы, меню и MCP, documentation and automation api»
> «так же сделай нормальный интерфейс на вкладке автомейшн, сейчас нет адаптивности»

> Wave 0 answers: «Вшить Inter локально (woff2 в репо)»; «Полноценно: статус + запуск + конфиг для копирования»; «Ссылка на GitHub»; «Гибкие 3 панели: инспектор → drawer, палитра → иконки»; «Показывать реальную версию + проверка обновлений»; «Шрифт/оболочка/футер + адаптивность Automation».

## Requirements

| # | Requirement | Verbatim quote | Status |
|---|---|---|---|
| R01 | The interface reads like the ShardX reference: typography, spacing, section rhythm | «выголядил вот так» | in-spec |
| R02 | Inter is the real rendered typeface, self-hosted as woff2 inside the repo — not a CDN request | «шрифты» + «Вшить Inter локально» | in-spec |
| R03 | The sidebar footer exposes a **MCP panel**: live status, start/stop, and a copyable connection config | «MCP» + «Полноценно: статус + запуск + конфиг» | in-spec |
| R04 | The sidebar footer exposes an **Automation API panel**: loopback endpoint, copyable, with status | «automation api» | in-spec |
| R05 | A **Documentation** control exists, opening the GitHub docs | «documentation» + «Ссылка на GitHub» | in-spec |
| R06 | The sidebar shows the real app version and a genuine update check — «up to date» only when verified | screenshot «v2.0.3 / up to date» + «Показывать реальную версию + проверка обновлений» | in-spec |
| R07 | Sections and menu match the reference's grouping and ordering | «разделы, меню» | in-spec |
| R08 | The **Automation** tab is responsive: on a narrow window the inspector becomes a drawer and the palette collapses to icons; on a wide window all three panels show | «сейчас нет адаптивности» + «Гибкие 3 панели» | in-spec |
| R09 | No hardcoded panel widths remain in Automation; layout responds to available width | «нет адаптивности» | in-spec |
| R10i | The MCP panel must not claim a running server when it is not running — status reflects the process, not the intent | derived from the honesty law + «статус» | in-spec |
| R11i | Copying the MCP config yields a config that actually works (correct command, path, transport) | derived from «конфиг для копирования» | in-spec |
| R12i | Scope is the shell/footer/typography plus Automation responsiveness; FlowCanvas internals and Settings bodies are not re-architected | «Шрифт/оболочка/футер + адаптивность Automation» | in-spec |
| R13i | Existing capability is preserved: 7 destinations, sub-tabs, dense rows, zero chromatic colours | prior accepted state | in-spec |

## Verified facts gathered before planning (not assumptions)

- **`--font-sans: 'Inter', system-ui, …` is declared but Inter is never loaded** — no
  `@font-face`, no vendored files, no CDN link. The app renders **Segoe UI** today while the
  code claims Inter. Found by grep, not inference.
- **The MCP server is already fully implemented** at `./mcp/` (8 modules: protocol, auth,
  audit, tools, browser, redaction, server, index). 40+ tools across two tiers, stdio plus
  loopback HTTP at `/mcp`, RBAC scopes, allowlisted script registry, audit log.
  `mcp/src/index.ts` defaults to stdio; `MCP_HTTP_PORT` switches it to HTTP.
- **MCP is invisible to the product**: not in the root `package.json` scripts, not built
  (`mcp/dist/` absent), no reference from `src/main`, no UI.
- **There are no responsive rules at all**: `grep -c "@media" styles.css` → **0** across the
  entire renderer. `FlowCanvas.tsx` (2994 lines) hardcodes `width: 260` and `width: 180`.
- **No in-app documentation page exists**; `docs/*.md` are repo files only.
- `electron-updater` is present in `electron/main.ts` with `autoDownload = false`.
- The API service listens on the loopback API port and the renderer already knows the key
  (`src/renderer/src/api.ts`) — the Automation API panel can report a real endpoint.

## Out of scope (recorded, not scheduled)

- FlowCanvas node/edge internals and the flow model — only its layout responsiveness changes.
- Settings sub-page bodies beyond inheriting the new typography.
- A light theme (still dark-only by prior decision).
- Rewriting the MCP server: it exists; this change surfaces and runs it.
