# Requirements manifest — nulltrace-noir-page-sweep

Every row traces to the user's own words. Silence never cancels a row.

| ID | Requirement | Verbatim source | Status |
|---|---|---|---|
| R70 | Sweep the pages onto the noir tokens | «Да» to «Продолжать свип страниц?» | in-spec |
| R71 | Page chrome must carry no hue | carried from R33 («монотонных темных нуарных черно-белых тонах») and R67 | in-spec |
| R72 | Flow Canvas node/edge colours become token-driven | follows from R70; FlowCanvas holds 192 of the ~280 remaining literals | in-spec |
| R73 | The orphaned token dialect is removed from every page | follows from R70; Email.tsx alone has 20 `var(--x, #hex)` fallbacks | in-spec |
| R74 | Duplicate page titles removed | reported by the shell wave: `Proxies.tsx:156-170`, `Extensions.tsx:104-114` render their own `h2` while the shell renders one too | in-spec |
| R75 | Empty states consolidated onto one primitive | reported by reconnaissance: several inline variants inside `colSpan` cells | in-spec |
| R76i | Operator-chosen data colours are preserved | they are data, not chrome — profile/tag colour pickers | in-spec |
| R77i | Flow Canvas keeps its canvas + inspector architecture | the sectioned ShardX page form was not chosen (R69i); this is a reskin, not a re-architecture | in-spec |
