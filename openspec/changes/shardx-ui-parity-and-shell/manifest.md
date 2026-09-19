# Requirements manifest — UI parity with ShardBrowser + shell fixes

Lane T2. Change id: `shardx-ui-parity-and-shell`.
Source: operator message of 2026-09-19 + Wave 0 interview answers.

| id | requirement (observable) | verbatim source | wave-0 decision | status |
|----|--------------------------|-----------------|-----------------|--------|
| R01 | The sidebar can be collapsed and expanded, the state survives a restart, and the control is visible without reading docs | «Бери возможность сворачивать боковое меню.» | keep our collapse (the reference has none) and make the control discoverable | done |
| R02 | The footer shows the running app version | «Внизу должна писаться версия текущая.» | must render even when the backend cannot resolve it | done |
| R03 | After a scan, one control transfers profiles from every found folder into the folder currently in use | «Также После сканы профилей у нас должна быть кнопка перенести все в текущую папку, главную, которую я задал.» | new aggregate button above the list; per-row buttons stay | done |
| R04 | The UI matches the ShardBrowser reference's layout and visual system, in NullTrace's own colours and fonts | «Так же я хочу полностью такой же UI только с нашими цветами, шрифтами и тд https://github.com/ProxyShard/ShardBrowser/» | shell + Profiles page only; other pages inherit tokens | done |
| R05 | Shell anatomy matches the reference: 240px sidebar with grouped nav, titlebar, content padding, card-based surfaces | R04 | — | done |
| R06 | Status colours are semantic (ok/warn/danger carry hue); accent, buttons and active nav stay monochrome | «с нашими цветами» + interview | relax the chroma guard for status tokens only, keep it for accent/surfaces | done |
| R07 | The page name sits as a breadcrumb inside the content area, with page search beside it | interview answer «Как в референсе: хлебные крошки в контенте» | titlebar keeps window controls only | done |
| R08 | Profiles page matches the reference: 4 metric cards, tabs with counts, toolbar row, table, and a designed empty state | R04 + interview scope answer | four cards: Profiles / Running / Proxies / Devices | done |

## Constraints (must not break)

- `npm test` (131 files) and both typechecks stay green.
- The sidebar collapse and the update flow in the footer keep working — the reference has no collapse, so this is ours to preserve.
- Privacy: no new outbound requests. Fonts stay self-hosted; no CDN links.
- The token chroma test forbids hue in surface/accent tokens; R06 changes it deliberately and narrowly.
- One owner per file: `styles.css`/`App.tsx`/`i18n.tsx` → designer; `Settings.tsx` → fixer.

## Out of scope (deferred, not dropped)

- Re-skinning the other list pages (Proxies, Fingerprints, Extensions, Library, Cloud) — they inherit the new tokens but keep their current structure.
- Settings' ten sections, FlowCanvas, Calendar, Diagnostics, Teams.
