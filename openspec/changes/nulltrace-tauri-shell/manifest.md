# Requirements manifest — nulltrace-tauri-shell

Every row traces to the user's own words. Silence never cancels a row.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R38 | A Tauri shell over the same web UI, on Rust | «собрать наш интерфейс на Таури на Расте» + user chose «Сначала веб, потом Tauri-оболочка» | in-spec |
| R90 | The shell is a thin wrapper: it does not reimplement the application | follows from R38 and the earlier decision that the web path is the product | in-spec |
| R91 | The Node backend runs as a sidecar so the existing API keeps working | the renderer is already HTTP-only, so the shell only needs a webview and a backend process | in-spec |
| R92 | The macOS build stays unsigned and says so | no Apple Developer account; the same limitation the reference product documents | in-spec |
| R93i | The shell must NOT claim to remove installation | a Tauri app is still an `.app`/`.dmg`; the web path is what removes installation, and it already exists | in-spec |
