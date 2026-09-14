# Requirements manifest — nulltrace-noir-design

Every row traces to the user's own words (2026-09-14). Silence never cancels a row.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R60 | Interface redesigned to look like ShardX | «хочу чтобы было как shardx» | in-spec |
| R61 | Borders/boxes removed | «давай уберем рамки» | in-spec |
| R62 | Only thin dividers survive; not all borders removed | «Убрать коробки, оставить только тонкие разделители» | in-spec |
| R63 | Frameless window — no native title bar, no menu | «Frameless окно» | in-spec |
| R64 | Sidebar footer gains an AUTOMATION API block like ShardX | «Сделать блок AUTOMATION API как у ShardX» | in-spec |
| R65 | Design system + rebuild of the existing pages (not new architecture) | «Дизайн-система + перестройка существующих страниц» | in-spec |
| R66 | Sidebar navigation grouped under labelled sections | implied by R60 — ShardX shows WORKSPACE / LIBRARY / SYSTEM | in-spec |
| R67 | Monochrome only — no hue anywhere in chrome | carried from the earlier directive «в монотонных темных нуарных черно-белых тонах» (R33) | in-spec |
| R68i | Page architecture stays the same; only appearance and shell change | follows from the user choosing «Дизайн-система + перестройка существующих страниц» over the page-architecture option | in-spec |
| R69i | The Profiles page is NOT re-architected into ShardX's sectioned form | the option offering it was not chosen | deferred |

## Note on R61/R62

The user chose the middle option: remove the boxes, keep thin dividers. So:
- **REMOVE**: full-perimeter borders around cards, tables, panels, chips, pills,
  icon buttons, inputs; and the box-shadow elevation on those surfaces.
- **KEEP**: horizontal hairline separators that carry structure — table row
  dividers, section dividers, modal header/footer dividers, sidebar footer edge.
Surfaces are then distinguished by a subtle background step and spacing.

## Note on R63

Frameless means the native Windows title bar and the `File/Edit/View/Window` menu
bar both disappear, and the app must supply its own drag region and window
controls. Tray behaviour and the existing close-to-tray logic must keep working.
