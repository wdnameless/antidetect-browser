# Recon — bug sweep, repository rename, freemium completion (release 0.6.33)

## Request (verbatim)

> «Проверь ошибки, переименуй репозитрий в NullTrace Antidetect Browser и сделай доделай его во
> freemium, мы начинали но так и не закончили»

Three tasks: sweep for defects, rename the repository, finish the freemium work that was started
and left unfinished.

## 1. Bug sweep

An adversarial reviewer was dispatched over the least-reviewed areas — the licensing subsystem, the
proxy GEO background pass, and the preflight fix path — plus whatever recent commits touched. Its
findings are recorded separately once reproduced.

Baseline before the sweep: both typechecks clean, working tree on `main` with everything pushed,
version 0.6.32.

## 2. Rename — and what it could have broken

Measured before touching anything:

- GitHub rejects spaces in repository names, so «NullTrace Antidetect Browser» becomes the slug
  **`nulltrace-antidetect-browser`** (operator-selected). The display name goes into the repository
  description instead.
- `gh repo edit` has **no `--name` flag**; the rename therefore goes through
  `PATCH /repos/{owner}/{repo}`.
- **Nine tracked files referenced the old path**, one of them load-bearing: `tauri.conf.json`'s
  updater endpoint. A rename that missed it would silently stop every installed copy from ever
  updating again.
- The rename was performed and then verified rather than assumed: the **old** URLs still answer
  **HTTP 200** (GitHub redirects), so already-installed 0.6.32 builds keep updating, and the new
  endpoint serves 0.6.32 as well.

References were updated only where they point forward — instructions to run, links a user clicks,
the updater endpoint. `CHANGELOG.md` and an internal `.workflow/` recon note keep the name the
repository actually had at the time, because rewriting history to match a later rename would make
the record wrong.

## 3. Freemium — what "unfinished" actually means here

The Free/Pro *logic* was already built and working:

| Piece | State |
| --- | --- |
| `hasFeature('teams' \| 'sync')` | EXISTS, `licenseManager.ts` |
| Gates on the routes | APPLIED, 20+ call sites across `sync.ts` and `teams.ts` |
| Ed25519 licence issue/verify, key rotation, Rust-side verification | EXISTS, with tests including a regression that the **old leaked key is refused** |
| `LICENSE`, `LICENSE.COMMERCIAL`, `TRADEMARK.md`, `CLA.md` | EXIST |
| Private keys in tracked files | **ZERO** (measured; the historical leak is closed) |
| Free/Pro boundary | DEFINED by the operator in `docs/DECISIONS.md:91`: Free = everything local, Pro = teams + cloud sync, **no profile or seat limits** |

So the gap was never the mechanism. It is that a Free user has **no way to understand what Pro is
or to obtain it**: the only trace is one sentence on the sync page pointing at Settings, with no
comparison, no explanation, and no path to purchase.

## Wave 0 decisions (user-selected)

- **Slug**: `nulltrace-antidetect-browser`.
- **Scope**: build the storefront and the call to action; the purchase itself is an **external link
  the operator supplies**, not payment code inside the app. Payment integration (Telegram Stars /
  crypto) stays deferred as the project's own plan already recorded.

## Acceptance

1. The sweep's findings are reproduced and either fixed or explicitly explained.
2. The repository is renamed, the updater endpoint points at the new path, and **old URLs still
   resolve** so existing installations continue to update.
3. A Free user can see exactly what Pro adds, and can reach a real purchase link and the
   key-entry screen, from the place where the gate actually fires.
4. Free remains a complete product: nothing new is restricted, per the operator's recorded decision.
5. Expired licences still say so.
