## 1. Robot core

- [ ] 1.1 Implement cookieRobot module: URL list ingestion (txt/json), per-site navigation, randomized dwell (configurable range), scroll + mouse movement synthesis, occasional internal link click.
- [ ] 1.2 Session policy enforcement: maxPages, dwellMs range, sessionCapMs, per-domain rate limit; kill switch stops within one page-load.
- [ ] 1.3 Human-like input: reuse existing input synthesis if present, else add bezier mouse moves + variable typing cadence (no interaction with auth forms).
- [ ] 1.4 Unit tests: policy caps enforced, kill switch latency, URL list parsing incl. malformed lines.

## 2. Reporting and safety

- [ ] 2.1 Per-run report: {pagesVisited, cookiesSet, domainsTouched, durationMs, errors[]}; persisted + retrievable via API.
- [ ] 2.2 Never fill/submit forms, never click elements matching auth heuristics; blocklist support (domain glob).
- [ ] 2.3 Integration test on a local fixture site proving cookies/history accumulate and report is accurate.
