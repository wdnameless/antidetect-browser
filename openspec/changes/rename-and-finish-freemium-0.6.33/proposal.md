# Sweep, rename to NullTrace Antidetect Browser, finish freemium

## Why

Requested: «Проверь ошибки, переименуй репозитрий в NullTrace Antidetect Browser и сделай доделай
его во freemium, мы начинали но так и не закончили».

The freemium work was left in a half-finished state that is worth naming precisely, because it is
not what it looks like. The mechanism is done: tier checking, route gates, licence signing and
verification in two languages, and the legal surface all exist and work, and the private-key leak
recorded earlier is closed — there are no private keys in tracked files. What was never finished is
the part the operator actually sees. A Free user is told, in one sentence, that a feature needs Pro —
with no explanation of what Pro is, and no way to obtain it. That is the gap.

The rename is not cosmetic either. Nine tracked files referenced the old repository path, and one of
them is the updater endpoint: get it wrong and every installed copy silently stops updating, with no
error anywhere the operator would look.

## What Changes

- **The repository is renamed** to `nulltrace-antidetect-browser` and every forward-looking reference
  moves with it. GitHub redirects the old path, which was verified rather than assumed, so copies
  already installed keep updating.
- **A Free user can see what Pro is** — a plain two-column comparison stating that Free is the whole
  local product and Pro adds collaboration and encrypted sync, with no invented limits, because the
  operator's own recorded decision forbids them.
- **There is a real path to obtain it** — one upgrade control that opens an operator-supplied link,
  using the application's existing external-link mechanism rather than `window.open`, which a Tauri
  webview ignores.
- **The call to action appears where the gate actually fires**, not only in a settings page the user
  has to find first.
- **Expired licences keep saying they expired**, beside the upgrade path rather than replaced by it.

## Capabilities

### Modified Capabilities
- `licensing-and-fork-protection` — the tier boundary becomes legible and reachable from the Free
  tier, instead of being implemented but invisible.

## Impact

- Renderer: `pages/LicenseSettings.tsx`, `pages/SyncSettings.tsx`, `pages/Teams.tsx`, `i18n.tsx`.
- Rename touches `src-tauri/tauri.conf.json` (updater endpoint), `docs/RELEASE.md`, `deploy/*`,
  and three renderer files carrying repository links.
- No server change: the licensing API already returns what the UI needs.
- No new restrictions, no payment code, and no history rewrite.
