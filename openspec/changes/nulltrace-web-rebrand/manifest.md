# Requirements manifest — nulltrace-web-rebrand

Every row traces to the user's own words (2026-09-14). Silence never cancels a row.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R30 | Product runs as a web application, not an installed bundle | «хочу собрать наш интерфейс на Таури на Расте, чтобы это было веб-приложение, и не нужно было его бандлом ставить на мак» | in-spec |
| R31 | Supported on every OS | «Я хочу, чтобы он его поддерживала вся система. Это была веб-приложение.» | in-spec |
| R32 | Interface redesigned to look like ShardX | «Я хочу переделать интерфейс, чтобы он выглядел как упрокси шарда» | in-spec |
| R33 | Monotone dark noir, black-white only | «Только в монотонных темных нуарных черно-белых тонах» | in-spec |
| R34 | Product renamed NullTrace | «хочу, чтобы мы сделали ребрендинг, чтобы мой браузер назывался. NullTrace» | in-spec |
| R35 | Primary tagline "Zero footprint, infinite scale." | «Слоган был (Zero footprint, infinite scale. или Leave nothing behind.)» + user chose primary | in-spec |
| R36 | Secondary tagline "Leave nothing behind." | same, user chose subheading | in-spec |
| R37 | App icon is the reference mark from the screenshot | «Иконка браузера должна быть как на последнем скриншоте» | in-spec |
| R38 | Tauri on Rust, after the web path works | «собрать наш интерфейс на Таури на Расте» + user chose "web first, Tauri shell later" | in-spec (wave 2) |
| R39i | Design system before pages | user chose «Сначала дизайн-система, потом страницы» | in-spec |
| R40i | One SVG master, generated into all icon formats | user chose «SVG-мастер + генерация всех форматов» | in-spec |

## Hard constraint carried into every task

Data compatibility outranks the rename. `HMAC_SECRET` (`fingerprints/derivation.ts:8`)
seeds every profile fingerprint; `SIGNING_DOMAIN_PREFIX` (`security/signing.ts:55`)
signs releases; `DATA_DIR`/`DB_PATH`/`ANTIDETECT_*` locate existing installs. Renaming
any of them silently re-seeds fingerprints or orphans a user's profiles. The user asked
to rename the product, NOT to invalidate their data — so those identifiers keep their
current values and are documented as deliberately unchanged.
