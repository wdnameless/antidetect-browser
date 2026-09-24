# Manifest — sweep, rename, freemium (release 0.6.33)

## User requirements (verbatim)

> «Проверь ошибки, переименуй репозитрий в NullTrace Antidetect Browser и сделай доделай его во
> freemium, мы начинали но так и не закончили»

- **R01** — «Проверь ошибки» → *defects are actively hunted, not assumed absent.*
- **R02** — «переименуй репозиторий в NullTrace Antidetect Browser» → *the repository carries the
  product's name.*
- **R03** — «доделай его во freemium, мы начинали но так и не закончили» → *the freemium work that
  was started is completed.*

## Wave 0 decisions (user-selected)

- **R04** — Slug `nulltrace-antidetect-browser`; GitHub forbids spaces, so the display name
  «NullTrace Antidetect Browser» becomes the repository description.
- **R05** — Freemium scope: **storefront plus call to action**, with purchase as an **external link
  the operator supplies**. Payment integration stays deferred, as the project's own record already
  has it (R12 of `licensing-and-fork-protection`).

## Measured facts this change is built on

- **R06** — The rename is not cosmetic: nine tracked files referenced the old path, and one is
  load-bearing — `tauri.conf.json`'s updater endpoint. Missing it would silently stop every
  installed copy from updating, with no visible failure.
- **R07** — GitHub redirects the old path after a rename. Verified rather than assumed: old URLs
  answer HTTP 200 and still serve `latest.json`, so existing installations keep updating.
- **R08** — The freemium **logic** already exists and works: `hasFeature('teams' | 'sync')`, gates at
  20+ call sites in `sync.ts`/`teams.ts`, Ed25519 issue/verify with rotation and Rust-side
  verification, and the legal surface (`LICENSE`, `LICENSE.COMMERCIAL`, `TRADEMARK.md`, `CLA.md`).
- **R09** — The historical private-key leak is closed: **zero** private keys in tracked files.
- **R10** — The Free/Pro boundary is fixed by the operator in `docs/DECISIONS.md:91`: Free = every
  local feature, Pro = teams + cloud sync, and **no profile, seat or device limits**. It is not this
  change's place to add restrictions.

## Acceptance criteria

- **R11** — The sweep's findings are each reproduced before being acted on, and either fixed or
  explained; nothing is reported as fixed that was not.
- **R12** — The repository is renamed, the updater endpoint points at the new path, and the old URLs
  still resolve so that already-installed builds continue to receive updates.
- **R13** — References are updated only where they point forward. Historical records keep the name
  the repository actually had at the time.
- **R14** — A Free user can see exactly what Pro adds, and can reach both a real purchase link and
  the key-entry screen, from the place where the gate actually fires.
- **R15** — Free stays a complete product. Nothing new is gated.
- **R16** — An expired licence still says it expired, alongside — not instead of — the upgrade path.

## Non-goals

- **R17** — No payment processing inside the application.
- **R18** — No new Free-tier restrictions: the boundary is the operator's recorded decision.
- **R19** — No history rewrite. The committed-key leak is already closed going forward, and the
  force-push that would purge it from history remains the operator's call, as previously recorded.
