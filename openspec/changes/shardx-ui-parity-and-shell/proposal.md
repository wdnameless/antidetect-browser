# Proposal — ShardBrowser UI parity and shell fixes

## Why

The operator asked for three shell/data fixes and for the interface to match a reference
product's layout, in NullTrace's own colours and fonts:

> «Бери возможность сворачивать боковое меню. Внизу должна писаться версия текущая. Также
> После сканы профилей у нас должна быть кнопка перенести все в текущую папку, главную,
> которую я задал. Так же я хочу полностью такой же UI только с нашими цветами, шрифтами
> и тд https://github.com/ProxyShard/ShardBrowser/»

Reconnaissance established what is already true, which changes the work:

- **The collapse exists** (`Ctrl/Cmd+B`, a 52px rail, persisted). It is not missing — it is
  undiscoverable and the reference has no equivalent, so it must be preserved and surfaced.
- **The version line exists** but renders from `GET /status`, which answers `unknown` whenever
  the shell does not pass `ANTIDETECT_APP_VERSION`; the operator therefore sees a bare product
  name. It must always show a real number.
- **The transfer exists per row.** What is missing is one control that moves everything from
  every discovered folder into the folder in use.

## What changes

1. **Shell anatomy** adopts the reference's geometry: 240px sidebar (280px on very wide
   screens), grouped navigation with an uppercase section label, a titlebar that carries only
   window controls and drag, and content padding of 28px/24px.
2. **The page title moves into the content** as a `Workspace / <Page>` breadcrumb with page
   search beside it — the reference's arrangement, chosen in the Wave 0 interview.
3. **Surfaces become cards.** Content blocks sit on raised surfaces with the reference's radius
   and border treatment instead of the current flat panels.
4. **Status colours gain hue** — ok/warn/danger become legible at a glance on the dark UI. The
   accent, buttons, active navigation and all surfaces stay monochrome, which is the product's
   identity. The existing chroma guard is narrowed to those surfaces rather than deleted.
5. **Profiles page** gains the reference's vertical order: four metric cards (Profiles,
   Running, Proxies, Fingerprints), folder tabs with counts, a toolbar row, the table, and a
   designed empty state.
6. **Recover-old-data** gains one "Transfer all to <current folder>" button that walks every
   discovered folder.

## What does not change

- Other list pages inherit the new tokens but keep their current structure (deferred, recorded
  in the manifest).
- No new network requests: fonts stay self-hosted, as they are today.
- The update flow in the footer, the sidebar collapse, and every existing endpoint.

## Risk

`styles.css` is ~2100 lines and every page consumes its tokens, so a shell rewrite can move
things nobody looked at. Mitigation: the change is additive at the token layer (rename-free),
the Profiles page is verified against a real backend, and the full suite plus both typechecks
run before commit. One writer owns the stylesheet.
