# Interfaces — sweep, rename, freemium (0.6.33)

## Repository identity

```
old: https://github.com/wdnameless/antidetect-browser
new: https://github.com/wdnameless/nulltrace-antidetect-browser
slug: nulltrace-antidetect-browser    (GitHub forbids spaces)
display name: NullTrace Antidetect Browser  (repository description)
```

The old path keeps working through GitHub's redirect, verified by requesting it rather than assumed.
That matters because the updater endpoint is a hardcoded URL in a shipped binary: if the redirect
ever stopped, installed copies would stop updating with no error the operator would see.

## Updater contract — unchanged in shape, changed in path

```
plugins.updater.endpoints[0]
  before: .../wdnameless/antidetect-browser/releases/latest/download/latest.json
  after:  .../wdnameless/nulltrace-antidetect-browser/releases/latest/download/latest.json
plugins.updater.pubkey: UNCHANGED
```

The signing key is deliberately untouched. Rotating it would invalidate every signature already
published and break the update chain that was verified working for 0.6.27 through 0.6.32.

## Freemium — no server contract change

The API already returns what the storefront needs:

```ts
GET /api/v1/license/state -> { plan: 'free' | 'pro', email?: string, exp?: number, expired?: boolean }
```

Gated features keep answering `{ code: 'LICENSE_REQUIRED', msg: 'Pro license required' }` exactly as
before. No gate is added, removed, or moved — the Free/Pro boundary is the operator's recorded
decision (`docs/DECISIONS.md:91`) and is not this change's to alter.

## Renderer additions

```ts
// LicenseSettings.tsx — exported so the other two pages use one source, not three copies
export const PRO_PURCHASE_URL = 'https://github.com/wdnameless/nulltrace-antidetect-browser/discussions';
```

The constant is the single place the operator replaces with a real storefront link. It defaults to
the repository's Discussions page so the control is never dead.

## Unchanged (deliberately)

- `hasFeature`, `isPro`, `getLicenseState`, `validateLicenseKey` — no signature changes.
- The route gates in `sync.ts` / `teams.ts`.
- The signing keypair and `resources/license-public-key.pem`.
- `CHANGELOG.md` and historical `.workflow/` notes keep the repository's name at the time they were
  written; rewriting them to match a later rename would falsify the record.

## Ownership

| Area | Files |
| --- | --- |
| Rename references and updater endpoint | `src-tauri/tauri.conf.json`, `docs/RELEASE.md`, `deploy/*`, `pages/App.tsx`, `components/AutomationPanel.tsx`, `pages/CloudSync.tsx` |
| Storefront, comparison, upgrade path | `pages/LicenseSettings.tsx`, `pages/SyncSettings.tsx`, `pages/Teams.tsx`, `i18n.tsx` |
