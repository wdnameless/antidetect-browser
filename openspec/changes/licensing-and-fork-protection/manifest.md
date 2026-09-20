# Requirements manifest — licensing-and-fork-protection

Source of truth: the operator's own words in this session. Every row quotes verbatim.
Status: `open` · `in-spec` · `in-ticket` · `done` · `placeholder` · `deferred` · `dropped`.
Wave-0 decisions live in rows R07–R12 because they are quotes too — a decision not written
down is a decision that gets re-litigated.

## Operator's brief (verbatim)

> "Смотри, у нас с публичной репозиторией, но я хочу защититься от того, чтобы нас форкали,
> хочу, чтобы у нас был примиальный функционал, хочу лицензировать свой софт и так далее,
> как это сделать, давай составим план по защите."

> "Отличный план, приступаq к реализации"

Note on the brief: «примиальный» is a typo for «премиальный» (premium). Reading it literally
as «primitive» would invert the request. The intent — a paid tier above the free one — is
confirmed by the answers to the Wave-0 widget (R07, R08) and needs no further clarification.

## Requirements

| R## | Requirement | Verbatim quote | Status |
|---|---|---|---|
| R01 | Stop third parties from forking the project and shipping it as their own product | "я хочу защититься от того, чтобы нас форкали" | in-spec |
| R02 | Offer a paid (premium) tier above the free one | "хочу, чтобы у нас был примиальный функционал" | in-spec |
| R03 | License the software — put an actual licence on the repository | "хочу лицензировать свой софт" | in-spec |
| R04 | Produce a written protection plan before building | "давай составим план по защите" | done |
| R05 | Execute the plan | "приступаq к реализации" | in-ticket |
| R06 | The repository is public and stays public — the protection must work under that constraint | "у нас с публичной репозиторией" | in-spec |
| R07 | Licence = AGPL-3.0 for the community edition + commercial dual licence for those who cannot comply | "AGPL-3.0 + коммерческая двойная лицензия" | in-spec |
| R08 | Free/Pro boundary stays as it is today: everything local is free, Pro = teams + cloud sync | "Как сейчас: локально всё бесплатно, Pro = команды + облачный синк" | in-spec |
| R09 | No hardware binding — signature only | "Без привязки — только подпись" | in-spec |
| R10 | This wave = foundation: key rotation, LICENSE/TRADEMARK/CLA, Free/Pro boundary, licence check in Rust, issuance tooling | "Фундамент: ротация ключа, LICENSE/TRADEMARK/CLA, границы Free/Pro, проверка лицензии в Rust, инструмент выпуска" | in-spec |
| R11 | Rewrite git history (git filter-repo) and force-push, removing the leaked key | "Переписать историю (git filter-repo) + force-push" | in-ticket |
| R12 | Payment provider, when payments are built: Telegram bot + Stars/crypto | "Telegram-бот + Stars/крипта" | deferred |
| R13i | The leaked licence key must be rotated — a committed private key is a live threat, not cosmetic | (derived from R01+R10; implicit) | in-spec |

`i`-suffix rows are requirements implied by the brief rather than stated as their own sentence.
R13i is implicit in R01 (protection) + R10 (rotation): it is the single fact that makes every
other protection meaningless today, proven in `recon.md`.

## Scope edges — what is explicitly OUT of this wave

| Item | Why out | Status |
|---|---|---|
| Licensing/activation server (remote `activate`, heartbeat, device limits) | The operator chose R09 (no HWID) and R10 (foundation only). Offline Ed25519 validation is sufficient and has no uptime requirement. | deferred |
| Payment integration (Telegram bot, Stars, crypto) | R10 excludes it; R12 records the provider decision for the later wave. | deferred |
| Free-tier profile limits / feature throttling | R08 explicitly keeps the current boundary. Adding limits would contradict the operator's own answer. | dropped (by R08) |
| Machine-readable licence enforcement that survives a determined attacker | Not achievable for a public client; the honest goal is "no longer a two-minute patch", documented in `proposal.md`. | deferred |

## Acceptance

Observable, not vibes:

1. `LICENSE`, `TRADEMARK.md`, `CLA.md` exist and are referenced from `README.md`.
2. The private key committed in `tests/unit/licenseManager.test.ts` no longer matches the key
   pinned in the build; a licence it signs is **rejected** by `validateLicenseKey`.
3. A licence signed with the *new* vendor key is **accepted** — proven by a run, not a reading.
4. Rust refuses a licence whose signature does not verify, and the Node backend asks Rust for
   the verdict on the packaged build.
5. The repo ships no private key material: a secrets sweep over tracked files returns zero hits
   for `-----BEGIN … PRIVATE KEY-----`.
6. `npm test` and `cargo test` pass; the previous count of tests is not reduced.
7. A history-rewrite runbook exists and was rehearsed on a local mirror clone.
