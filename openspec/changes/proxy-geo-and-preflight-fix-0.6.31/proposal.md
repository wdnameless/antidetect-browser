# Proxy GEO and preflight FIX

## Why

Requested: «Так же в прокси должно показываться ГЕО. И проблемы при preflight надо добавить кнопку
FIX и фиксить их.»

The proxy list does not say where a proxy actually exits. The columns exist in the database and a
check fills them, but only when a row is tested by hand — so with 142 proxies the column is mostly
blank or reads "Not tested", and the operator cannot see at a glance whether a proxy is where they
think it is.

The preflight modal diagnoses thoroughly — proxy, timezone, language, WebRTC, DNS, QUIC, coherence —
and then stops. Every warning is described and none is actionable, so the operator reads a list of
problems and has nowhere to go with them.

## What Changes

- **The proxy list shows real geography.** Flag, country, city and timezone per row, resolved
  automatically in the background rather than per-row by hand. `city` is added to the lookup and to
  storage; the list route exposes it along with the coordinates it already had.
- **The fill is paced, resumable and safe to repeat.** The library holds 142 proxies and the
  geolocation service allows 45 lookups per minute, so the pass is spaced to stay inside the limit,
  skips rows that already resolved, and never blocks the UI.
- **The preflight modal gains a Fix action.** It applies what is safely fixable — the WebRTC policy,
  the profile timezone, and the fingerprint language, which is derived from the proxy's country
  using the mapping the preflight service already has — and then re-runs the checks so the operator
  sees the result rather than the old verdict.
- **Problems a button cannot fix say so.** A DNS leak is a property of an HTTP proxy, and QUIC needs
  relay infrastructure; neither is a profile setting, so the modal reports the reason instead of
  pretending. Nothing is changed automatically for DNS.

## Capabilities

### New Capabilities
- `proxy-geo-visibility` — where each proxy exits, shown and kept current.
- `preflight-remediation` — applying fixes to what preflight finds.

### Modified Capabilities
None — the detection logic is untouched; this changes what the operator can do about its findings.

## Impact

- Main: `src/main/proxy/proxyManager.ts`, `src/main/api/routes/proxy.ts`, `src/main/db/schema.ts`.
- Renderer: `src/renderer/src/pages/Proxies.tsx`, `src/renderer/src/components/PreflightModal.tsx`,
  `src/renderer/src/preflight.ts`, `src/renderer/src/pages/Profiles.tsx`, `api.ts`, `i18n.tsx`.
- One migration by the repository's existing `ensureColumn` helper (adds `city`). No dependency
  additions; the flag is computed from the ISO code.
